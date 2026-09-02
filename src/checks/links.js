/**
 * Обход внутренних ссылок.
 *
 * Эту проверку попросил сам агент: в отчёте он написал, что не видит на главной
 * ссылок на каталог, но не может сказать, беда это сайта или предел инструмента.
 * Теперь может.
 *
 * Что делает: собирает ссылки со страницы, проверяет коды ответа, отделяет
 * внутренние от внешних, смотрит тексты ссылок. При глубине больше единицы
 * переходит по внутренним ссылкам дальше.
 */
import * as cheerio from 'cheerio'
import { fetchText, request, describeError } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/**
 * Сколько запросов держим одновременно и сколько ждём между пачками.
 *
 * Числа занижены намеренно. При пяти параллельных запросах сайты начинают
 * отвечать 429 — сервер защищается от того, что принял за атаку. И тогда
 * проверка объявляет битыми живые страницы, а это в аудите хуже, чем пропуск.
 */
const CONCURRENCY = 3
const PAUSE_MS = 250

/** Коды, которые означают «сервер попросил притормозить», а не «страницы нет». */
const THROTTLED = new Set([429, 503])

/** Тексты ссылок, которые ничего не сообщают. */
const VAGUE = /^(здесь|тут|сюда|подробнее|подробне|читать далее|далее|ещё|еще|ссылка|перейти|click here|here|read more|more|link)\.?$/i

export async function checkLinks(startUrl, options = {}) {
  const { depth = 1, maxPages = 20, maxLinks = 80, timeoutMs = 15000 } = options
  const found = reporter()

  let origin
  try {
    origin = new URL(startUrl).origin
  } catch {
    return { url: startUrl, ok: false, error: 'Неверный адрес', findings: [], summary: {} }
  }

  // ── обход страниц ─────────────────────────────────────────────────────────
  const visited = new Set()
  const queue = [{ url: normalize(startUrl), level: 1 }]
  const links = new Map() // адрес → { internal, anchors: [], nofollow, fromPages: Set }
  const anchors = { empty: 0, vague: 0 }
  let pagesCrawled = 0

  while (queue.length && pagesCrawled < maxPages) {
    const { url, level } = queue.shift()
    if (visited.has(url)) continue
    visited.add(url)

    let page
    try {
      page = await fetchText(url, { timeoutMs })
    } catch (error) {
      if (pagesCrawled === 0) {
        return {
          url: startUrl,
          ok: false,
          error: describeError(error, timeoutMs),
          findings: [],
          summary: {},
        }
      }
      continue
    }

    if (!page.ok) continue

    // Домен берём ПОСЛЕ переадресации. Если сайт переехал, ссылки будут вести
    // на новый домен, и по исходному адресу все они выглядели бы внешними.
    if (pagesCrawled === 0) origin = new URL(page.finalUrl).origin

    pagesCrawled += 1

    const $ = cheerio.load(page.body)

    $('a[href]').each((_, el) => {
      const raw = ($(el).attr('href') || '').trim()
      if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) return

      let absolute
      try {
        absolute = normalize(new URL(raw, page.finalUrl).href)
      } catch {
        return
      }

      const internal = absolute.startsWith(origin)

      // Текст ссылки: собственный текст либо alt картинки внутри
      const text = $(el).text().trim().replace(/\s+/g, ' ')
      const alt = $(el).find('img[alt]').first().attr('alt') || ''
      const label = text || alt.trim()
      const ariaLabel = ($(el).attr('aria-label') || '').trim()

      if (!label && !ariaLabel) anchors.empty += 1
      else if (VAGUE.test(label)) anchors.vague += 1

      if (!links.has(absolute)) {
        links.set(absolute, {
          internal,
          nofollow: false,
          labels: [],
          fromPages: new Set(),
        })
      }

      const entry = links.get(absolute)
      entry.fromPages.add(url)
      if (label) entry.labels.push(label)
      if (/\bnofollow\b/i.test($(el).attr('rel') || '')) entry.nofollow = true

      if (internal && level < depth && !visited.has(absolute)) {
        queue.push({ url: absolute, level: level + 1 })
      }
    })
  }

  // ── проверка кодов ответа ─────────────────────────────────────────────────
  const internalLinks = [...links.entries()].filter(([, item]) => item.internal)
  const externalLinks = [...links.entries()].filter(([, item]) => !item.internal)

  const toCheck = [
    ...internalLinks.slice(0, maxLinks).map(([url]) => ({ url, internal: true })),
    ...externalLinks.slice(0, Math.floor(maxLinks / 4)).map(([url]) => ({ url, internal: false })),
  ]

  const statuses = await inPool(toCheck, CONCURRENCY, async (item) => {
    try {
      let response = await request(item.url, { timeoutMs, redirect: 'manual' })

      // Попросили притормозить — подождём и спросим ещё раз. Чаще всего этого хватает.
      if (THROTTLED.has(response.status)) {
        await sleep(1200)
        response = await request(item.url, { timeoutMs, redirect: 'manual' })
      }

      return {
        ...item,
        status: response.status,
        location: response.headers.get('location'),
        throttled: THROTTLED.has(response.status),
      }
    } catch {
      return { ...item, status: null, throttled: false }
    }
  })

  // Ограниченные по частоте в подсчёт битых не идут: мы не знаем, живые они или нет
  const throttled = statuses.filter((item) => item.throttled)
  const judged = statuses.filter((item) => !item.throttled)

  const broken = judged.filter((item) => item.internal && (item.status === null || item.status >= 400))
  const redirected = judged.filter((item) => item.internal && item.status >= 300 && item.status < 400)
  const brokenExternal = judged.filter((item) => !item.internal && item.status !== null && item.status >= 400)
  const nofollowInternal = internalLinks.filter(([, item]) => item.nofollow)

  // ── формы адресов, чтобы увидеть структуру ────────────────────────────────
  const shapes = new Map()
  for (const [url] of internalLinks) {
    const shape = shapeOf(url)
    shapes.set(shape, (shapes.get(shape) || 0) + 1)
  }
  const byShape = [...shapes.entries()]
    .map(([shape, total]) => ({ shape, total }))
    .sort((a, b) => b.total - a.total)

  // Выборка живых внутренних страниц: по одной на каждую форму адреса.
  // Нужна тем, кто идёт дальше и смотрит страницы поштучно — прогону без
  // модели и самой модели. Без неё на сайте без карты проверять нечего,
  // кроме главной.
  const seenShapes = new Set()
  const sample = []
  for (const [url, item] of internalLinks) {
    if (url === normalize(startUrl)) continue
    if (item.nofollow) continue

    const status = statuses.find((entry) => entry.url === url)
    if (status && (status.status === null || status.status >= 400)) continue

    const shape = shapeOf(url)
    if (seenShapes.has(shape)) continue
    seenShapes.add(shape)
    sample.push(url)
    if (sample.length >= 5) break
  }

  // ── замечания ─────────────────────────────────────────────────────────────
  if (internalLinks.length === 0) {
    found.add('links-none')
  } else if (internalLinks.length < 8) {
    found.add('links-few', { count: counted(internalLinks.length, FORMS.link) })
  }

  if (broken.length) {
    found.add(
      'link-broken',
      { count: broken.length, examples: broken.slice(0, 2).map((item) => item.url).join(', ') },
      { list: broken.slice(0, 10).map((item) => ({ url: item.url, status: item.status })) },
    )
  }

  if (redirected.length) {
    found.add(
      'link-redirect',
      { count: redirected.length, examples: redirected.slice(0, 2).map((item) => item.url).join(', ') },
      { list: redirected.slice(0, 10).map((item) => ({ url: item.url, to: item.location })) },
    )
  }

  if (throttled.length) {
    found.add('link-check-throttled', { count: throttled.length })
  }

  if (anchors.empty) found.add('link-empty-anchor', { count: anchors.empty })
  if (anchors.vague) found.add('link-vague-anchor', { count: anchors.vague })
  if (nofollowInternal.length) found.add('link-nofollow-internal', { count: nofollowInternal.length })
  if (brokenExternal.length) {
    found.add('link-external-broken', {
      count: brokenExternal.length,
      examples: brokenExternal.slice(0, 2).map((item) => item.url).join(', '),
    })
  }

  // Все ссылки одного уровня вложенности — значит разделов в разметке нет
  const levels = new Set(byShape.map((item) => item.shape.split(', ')[1]).filter(Boolean))
  if (internalLinks.length >= 4 && levels.size === 1 && byShape.length <= 12) {
    found.add('links-single-section', {
      shapes: byShape.slice(0, 4).map((item) => item.shape).join(', '),
    })
  }

  const findings = found.list()

  return {
    url: startUrl,
    ok: true,
    origin,
    pagesCrawled,
    depth,
    internal: {
      total: internalLinks.length,
      checked: statuses.filter((item) => item.internal).length,
      broken: broken.map((item) => ({ url: item.url, status: item.status })),
      redirects: redirected.map((item) => ({ url: item.url, to: item.location })),
      throttled: throttled.filter((item) => item.internal).map((item) => item.url),
      sample,
    },
    external: {
      total: externalLinks.length,
      hosts: [...new Set(externalLinks.map(([url]) => safeHost(url)))].slice(0, 15),
      broken: brokenExternal.map((item) => item.url),
    },
    anchors,
    byShape: byShape.slice(0, 15),
    findings,
    summary: summarize(findings),
  }
}

/** Убираем якорь и приводим к единому виду, чтобы не считать один адрес дважды. */
function normalize(url) {
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

/** Форма пути: первый раздел плюс глубина. То же деление, что и для карты сайта. */
function shapeOf(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  if (!segments.length) return '/, уровень 0'
  const section = segments[0].length > 24 ? segments[0].slice(0, 24) + '…' : segments[0]
  return `${section}, уровень ${segments.length}`
}

function safeHost(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Выполняет задачи пачками по несколько штук.
 * Без ограничения мы бы выстрелили сотней одновременных запросов
 * в чужой сервер — это уже похоже на атаку, а не на аудит.
 */
async function inPool(items, size, worker) {
  const results = []
  for (let index = 0; index < items.length; index += size) {
    if (index > 0) await sleep(PAUSE_MS)
    const batch = items.slice(index, index + size)
    results.push(...(await Promise.all(batch.map(worker))))
  }
  return results
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
