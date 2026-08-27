/**
 * Контент и дубли.
 *
 * Единственная проверка, которой мало одной страницы: дубли по определению
 * видны только при сравнении нескольких. Поэтому она сама забирает набор
 * адресов и сравнивает их между собой.
 */
import * as cheerio from 'cheerio'
import { fetchText } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/** Меньше этого — считаем страницу тонкой, совсем мало — пустой. */
const THIN_WORDS = 150
const EMPTY_WORDS = 30

/** Насколько тексты должны совпасть, чтобы это уже был дубль. */
const DUPLICATE_RATIO = 0.8

/** Обрывки текста из демонстрационных наборов, которые забывают убрать. */
const TEMPLATE_HINTS = [
  'lorem ipsum',
  'dolor sit amet',
  'ваш текст здесь',
  'текст заголовка',
  'описание компании',
  'здесь может быть ваш',
  'company name',
  'пример текста',
]

export async function checkContent(urls, options = {}) {
  const { timeoutMs = 15000, maxPages = 10 } = options
  const found = reporter()

  const list = (Array.isArray(urls) ? urls : [urls]).slice(0, maxPages)
  const pages = []

  for (const url of list) {
    try {
      const page = await fetchText(url, { timeoutMs })
      if (!page.ok) continue
      pages.push(extract(url, page.body))
    } catch {
      // недоступная страница — забота других проверок
    }
  }

  if (pages.length === 0) {
    return { ok: false, error: 'Ни одна страница не открылась', findings: [], summary: {} }
  }

  // ── повторы мета-тегов ────────────────────────────────────────────────────
  for (const [value, group] of groupBy(pages, (page) => page.title)) {
    if (!value || group.length < 2) continue
    found.add('duplicate-title', {
      value: cut(value, 60),
      count: counted(group.length, FORMS.pageOn),
      pages: group.map((page) => shortPath(page.url)).slice(0, 4).join(', '),
    })
  }

  for (const [value, group] of groupBy(pages, (page) => page.description)) {
    if (!value || group.length < 2) continue
    found.add('duplicate-description', {
      count: counted(group.length, FORMS.pageOn),
      pages: group.map((page) => shortPath(page.url)).slice(0, 4).join(', '),
    })
  }

  // ── повторы текста ────────────────────────────────────────────────────────
  const duplicates = []
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const ratio = similarity(pages[i].shingles, pages[j].shingles)
      if (ratio >= DUPLICATE_RATIO) {
        duplicates.push({ a: pages[i].url, b: pages[j].url, ratio })
        found.add('duplicate-text', {
          a: shortPath(pages[i].url),
          b: shortPath(pages[j].url),
          percent: Math.round(ratio * 100),
        })
      }
    }
  }

  // ── объём и заглушки ──────────────────────────────────────────────────────
  for (const page of pages) {
    if (page.words < EMPTY_WORDS) {
      found.add('empty-page', { url: shortPath(page.url) })
    } else if (page.words < THIN_WORDS) {
      found.add('thin-content', { url: shortPath(page.url), words: counted(page.words, FORMS.word) })
    }

    if (page.templateHint) {
      found.add('template-content', { url: shortPath(page.url), sample: cut(page.templateHint, 60) })
    }
  }

  // ── контакты ──────────────────────────────────────────────────────────────
  const phones = new Set()
  for (const page of pages) for (const phone of page.phones) phones.add(phone)

  if (phones.size > 2) {
    found.add('contacts-mismatch', {
      count: phones.size,
      values: [...phones].slice(0, 4).join(', '),
    })
  }

  const findings = found.list()

  return {
    ok: true,
    checked: pages.length,
    pages: pages.map((page) => ({
      url: page.url,
      words: page.words,
      title: page.title || null,
      hasDescription: Boolean(page.description),
    })),
    duplicates,
    phones: [...phones],
    findings,
    summary: summarize(findings),
  }
}

/** Достаёт из страницы то, что нужно для сравнения. */
function extract(url, html) {
  const $ = cheerio.load(html)

  $('script, style, noscript, svg').remove()

  const title = ($('head > title').first().text() || '').trim().replace(/\s+/g, ' ')
  const description = ($('meta[name="description"]').attr('content') || '').trim().replace(/\s+/g, ' ')

  // Основной текст: если есть main или article, берём их — так меньше шума
  // от меню и подвала, которые совпадают на всех страницах по определению.
  const container = $('main').length ? $('main') : $('article').length ? $('article') : $('body')
  const text = container.text().replace(/\s+/g, ' ').trim()

  const words = text.split(/\s+/).filter((word) => word.length > 1).length
  const lower = text.toLowerCase()

  return {
    url,
    title,
    description,
    words,
    shingles: shingles(lower),
    templateHint: TEMPLATE_HINTS.find((hint) => lower.includes(hint)) || null,
    phones: findPhones(text),
  }
}

/**
 * Разбивает текст на пересекающиеся тройки слов.
 *
 * Сравнивать тексты целиком бессмысленно: достаточно поменять одно слово,
 * и строки уже разные. А доля общих троек показывает реальное сходство.
 */
function shingles(text, size = 3) {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2)
  const result = new Set()
  for (let i = 0; i + size <= words.length; i++) {
    result.add(words.slice(i, i + size).join(' '))
  }
  return result
}

/** Доля общих троек: делим пересечение на меньшее множество. */
function similarity(a, b) {
  if (!a.size || !b.size) return 0
  let common = 0
  for (const item of a) if (b.has(item)) common += 1
  return common / Math.min(a.size, b.size)
}

/** Телефоны в российском формате, приведённые к единому виду. */
function findPhones(text) {
  const matches = text.match(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g) || []
  return [...new Set(matches.map((phone) => phone.replace(/\D/g, '').replace(/^8/, '7')))]
}

function groupBy(items, key) {
  const groups = new Map()
  for (const item of items) {
    const value = key(item)
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value).push(item)
  }
  return groups
}

function shortPath(url) {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search || '/'
  } catch {
    return url
  }
}

const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text)
