/**
 * Зеркала и дубли адресов.
 *
 * Первое, что смотрят в техническом аудите. Пока поисковик видит вместо
 * одного сайта три копии, всё остальное не имеет смысла: вес размазан,
 * а какая копия окажется в выдаче, решает не владелец сайта.
 */
import * as cheerio from 'cheerio'
import { probe, fetchText, originOf } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/** Технические адреса главной, которые обычно остаются доступными по недосмотру. */
const INDEX_FILES = ['index.php', 'index.html', 'index.htm', 'default.html', 'home']

/** Параметр, которым проверяем, плодятся ли дубли. Метка рекламной кампании безобидна. */
const TEST_PARAM = 'utm_source=revizor-check'

export async function checkMirrors(siteUrl, options = {}) {
  const { timeoutMs = 15000 } = options
  const found = reporter()

  let origin
  try {
    origin = originOf(siteUrl)
  } catch {
    return { url: siteUrl, ok: false, error: 'Неверный адрес', findings: [], summary: {} }
  }

  const host = new URL(origin).host
  const bare = host.replace(/^www\./i, '')
  const withWww = `https://www.${bare}/`
  const withoutWww = `https://${bare}/`

  const ask = (url) => probe(url, { timeoutMs })

  // ── зеркала с www и без ───────────────────────────────────────────────────
  const [a, b] = await Promise.all([ask(withoutWww), ask(withWww)])
  const mirrors = { withoutWww: a, withWww: b }

  if (a.status === 200 && b.status === 200 && !a.throttled && !b.throttled) {
    found.add('mirror-both-alive', { a: withoutWww, b: withWww })
  }

  // ── незащищённая версия ───────────────────────────────────────────────────
  const insecure = await followChain(`http://${bare}/`, timeoutMs)
  if (insecure.reachable) {
    if (insecure.hops === 0 && insecure.finalStatus === 200) {
      found.add('mirror-http-alive', { status: insecure.finalStatus })
    } else if (insecure.hops > 1) {
      found.add('mirror-http-chain', { count: counted(insecure.hops, FORMS.redirect) })
    }
  }

  // ── технические дубли главной ─────────────────────────────────────────────
  const indexDuplicates = []
  for (const file of INDEX_FILES) {
    const candidate = origin + file
    const result = await ask(candidate)
    if (result.status === 200 && !result.throttled) {
      indexDuplicates.push(candidate)
      found.add('index-file-duplicate', { url: candidate })
    }
  }

  // ── слэш на конце ─────────────────────────────────────────────────────────
  // Проверяем на реальной внутренней странице: у корня слэш не показателен.
  const inner = await firstInnerPage(origin, timeoutMs)
  let slash = null

  if (inner) {
    const withSlash = inner.endsWith('/') ? inner : inner + '/'
    const withoutSlash = inner.replace(/\/+$/, '')
    const [one, two] = await Promise.all([ask(withSlash), ask(withoutSlash)])
    slash = { withSlash: one.status, withoutSlash: two.status }

    if (one.status === 200 && two.status === 200 && !one.throttled && !two.throttled) {
      found.add('slash-duplicate', { a: withSlash, b: withoutSlash })
    }
  }

  // ── параметры в адресе ────────────────────────────────────────────────────
  const paramUrl = `${origin}?${TEST_PARAM}`
  const paramPage = await safeFetch(paramUrl, timeoutMs)
  let params = null

  if (paramPage && paramPage.ok) {
    const $ = cheerio.load(paramPage.body)
    const canonical = ($('link[rel="canonical"]').first().attr('href') || '').trim()
    const clean = !canonical || !canonical.includes('utm_')
    params = { status: paramPage.status, canonical: canonical || null }

    if (!canonical || !clean) {
      found.add('params-duplicate', {
        param: 'utm_source',
        canonical: canonical ? `указывает на «${canonical}»` : 'отсутствует',
      })
    }
  }

  // ── несуществующая страница ───────────────────────────────────────────────
  const missing = await ask(`${origin}revizor-nesushchestvuyushchiy-adres-${Date.now()}`)
  if (missing.status && !missing.throttled && missing.status !== 404 && missing.status < 500) {
    found.add('soft-404', { status: missing.status })
  }

  const findings = found.list()

  return {
    url: siteUrl,
    ok: true,
    origin,
    mirrors: {
      withoutWww: { url: withoutWww, status: a.status, redirectsTo: a.location },
      withWww: { url: withWww, status: b.status, redirectsTo: b.location },
    },
    insecure: { hops: insecure.hops, finalStatus: insecure.finalStatus },
    indexDuplicates,
    slash,
    params,
    missingPageStatus: missing.status,
    findings,
    summary: summarize(findings),
  }
}

/** Проходит цепочку переадресаций и считает шаги. */
async function followChain(url, timeoutMs, maxHops = 6) {
  let current = url
  let hops = 0

  for (let step = 0; step <= maxHops; step++) {
    const result = await probe(current, { timeoutMs })
    if (!result.reachable) return { reachable: false, hops, finalStatus: null }

    if (result.status >= 300 && result.status < 400 && result.location) {
      current = new URL(result.location, current).href
      hops += 1
      continue
    }

    return { reachable: true, hops, finalStatus: result.status, finalUrl: current }
  }

  return { reachable: true, hops, finalStatus: null }
}

/** Первая внутренняя страница с главной: на ней проверяем слэш. */
async function firstInnerPage(origin, timeoutMs) {
  const page = await safeFetch(origin, timeoutMs)
  if (!page || !page.ok) return null

  const $ = cheerio.load(page.body)
  let result = null

  $('a[href]').each((_, el) => {
    if (result) return
    try {
      const absolute = new URL($(el).attr('href'), page.finalUrl)
      absolute.hash = ''
      absolute.search = ''
      if (absolute.origin + '/' !== origin) return
      if (absolute.pathname === '/' || absolute.pathname.length < 2) return
      if (/\.[a-z0-9]{2,5}$/i.test(absolute.pathname)) return // файлы пропускаем
      result = absolute.href
    } catch {
      // мусорная ссылка
    }
  })

  return result
}

async function safeFetch(url, timeoutMs) {
  try {
    return await fetchText(url, { timeoutMs })
  } catch {
    return null
  }
}
