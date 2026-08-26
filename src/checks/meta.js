/**
 * Проверка содержимого страницы: мета-теги, заголовки, canonical, alt у картинок.
 *
 * Это самый плотный по находкам инструмент: правки в title и H1 дают
 * заметный результат раньше всего остального.
 */
import * as cheerio from 'cheerio'
import { fetchText, describeError } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/** Ориентиры длины. Взяты из практики, а не из стандарта: стандарта тут нет. */
const TITLE_MIN = 30
const TITLE_MAX = 70
const DESCRIPTION_MIN = 70
const DESCRIPTION_MAX = 180

export async function checkMeta(url, options = {}) {
  const { timeoutMs = 15000 } = options
  const found = reporter()

  let page
  try {
    page = await fetchText(url, { timeoutMs })
  } catch (error) {
    const message = describeError(error, timeoutMs)
    found.add('page-unreachable', { error: message })
    return { url, ok: false, error: message, findings: found.list(), summary: summarize(found.list()) }
  }

  if (!page.ok) {
    found.add('page-bad-status', { status: page.status })
    return {
      url,
      ok: false,
      status: page.status,
      error: page.error || `Сервер ответил ${page.status}`,
      findings: found.list(),
      summary: summarize(found.list()),
    }
  }

  const $ = cheerio.load(page.body)

  // ── что вытащили ──────────────────────────────────────────────────────────
  const title = text($('head > title').first())
  const description = attr($('meta[name="description"]').first(), 'content')
  const robotsMeta = attr($('meta[name="robots"]').first(), 'content')
  const canonical = attr($('link[rel="canonical"]').first(), 'href')
  const lang = attr($('html').first(), 'lang')

  const headings = []
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push({ level: Number(el.tagName[1]), text: text($(el)) })
  })
  const h1 = headings.filter((heading) => heading.level === 1).map((heading) => heading.text)

  const og = {
    title: attr($('meta[property="og:title"]').first(), 'content'),
    description: attr($('meta[property="og:description"]').first(), 'content'),
    image: attr($('meta[property="og:image"]').first(), 'content'),
  }

  const images = $('img')
  const withoutAlt = []
  images.each((_, el) => {
    const alt = $(el).attr('alt')
    if (alt === undefined || alt.trim() === '') {
      const src = $(el).attr('src') || $(el).attr('data-src') || '(без src)'
      withoutAlt.push(src.slice(0, 120))
    }
  })

  const schemaTypes = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text())
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && item['@type']) schemaTypes.push(item['@type'])
      }
    } catch {
      found.add('bad-jsonld')
    }
  })

  // ── что из этого следует ──────────────────────────────────────────────────
  if (!title) {
    found.add('no-title')
  } else {
    if (title.length < TITLE_MIN) {
      found.add('title-short', { length: counted(title.length, FORMS.symbol), max: TITLE_MAX })
    }
    if (title.length > TITLE_MAX) {
      found.add('title-long', { length: counted(title.length, FORMS.symbol), max: TITLE_MAX })
    }
  }

  if (!description) {
    found.add('no-description')
  } else {
    if (description.length < DESCRIPTION_MIN) {
      found.add('description-short', {
        length: counted(description.length, FORMS.symbol),
        min: DESCRIPTION_MIN,
      })
    }
    if (description.length > DESCRIPTION_MAX) {
      found.add('description-long', {
        length: counted(description.length, FORMS.symbol),
        max: DESCRIPTION_MAX,
      })
    }
    if (title && description.trim() === title.trim()) {
      found.add('description-equals-title')
    }
  }

  if (h1.length === 0) found.add('no-h1')
  if (h1.length > 1) found.add('multiple-h1', { count: counted(h1.length, FORMS.heading) })
  if (h1.length === 1 && title && h1[0].trim() === title.trim()) found.add('h1-equals-title')

  const skip = findHeadingSkip(headings)
  if (skip) {
    found.add('heading-skip', { from: skip.from, to: skip.to, text: skip.text })
  }

  if (!canonical) {
    found.add('no-canonical')
  } else if (!sameUrl(canonical, page.finalUrl)) {
    found.add('canonical-other', { canonical })
  }

  if (robotsMeta && /noindex/i.test(robotsMeta)) {
    found.add('meta-noindex', { content: robotsMeta })
  }

  const bodyText = text($('body'))
  if (!lang) {
    found.add('no-lang')
  } else if (looksRussian(bodyText) && !/^ru/i.test(lang)) {
    found.add('wrong-lang', { lang })
  }

  if (!og.title || !og.image) found.add('og-incomplete')

  if (withoutAlt.length) {
    found.add(
      'images-no-alt',
      { count: counted(withoutAlt.length, FORMS.image), total: images.length },
      { examples: withoutAlt.slice(0, 5) },
    )
  }

  if (!schemaTypes.length) found.add('no-schema')

  // Приложение с отрисовкой на стороне браузера: в исходном HTML пусто,
  // содержимое появляется только после выполнения скриптов.
  if (bodyText.length < 200 && headings.length === 0 && $('script[src]').length > 0) {
    found.add('client-rendered')
  }

  const findings = found.list()

  return {
    url,
    ok: true,
    status: page.status,
    finalUrl: page.finalUrl,
    title: title ? { text: title, length: title.length } : null,
    description: description ? { text: description, length: description.length } : null,
    h1,
    headings: headings.slice(0, 40),
    canonical,
    robotsMeta,
    lang,
    og,
    images: { total: images.length, withoutAlt: withoutAlt.length, examples: withoutAlt.slice(0, 5) },
    schemaTypes,
    findings,
    summary: summarize(findings),
  }
}

/** Первый пропуск уровня: после H2 сразу H4 и подобное. */
function findHeadingSkip(headings) {
  let previous = 0
  for (const heading of headings) {
    if (previous && heading.level > previous + 1) {
      return { from: previous, to: heading.level, text: heading.text.slice(0, 60) }
    }
    previous = heading.level
  }
  return null
}

/** Сравнение адресов без учёта слэша на конце и регистра схемы. */
function sameUrl(a, b) {
  try {
    const normalize = (value) => {
      const parsed = new URL(value)
      return (parsed.origin + parsed.pathname).replace(/\/+$/, '').toLowerCase()
    }
    return normalize(a) === normalize(b)
  } catch {
    return false
  }
}

/** Диапазон кириллицы в Юникоде: строчные а–я плюс ё. */
const CYRILLIC = /[а-яё]/gi

/** Грубая прикидка: заметная доля кириллицы означает русский текст. */
function looksRussian(value) {
  if (value.length < 120) return false
  const cyrillic = (value.match(CYRILLIC) || []).length
  return cyrillic / value.length > 0.2
}

const text = (node) => (node.length ? node.text().trim().replace(/\s+/g, ' ') : '')
const attr = (node, name) => (node.length ? (node.attr(name) || '').trim() : '')
