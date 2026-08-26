/**
 * Разбор карты сайта.
 *
 * Карта бывает двух видов: список адресов (urlset) и список других карт
 * (sitemapindex). Второй вариант встречается на больших сайтах, поэтому
 * инструмент умеет заглянуть на один уровень вглубь.
 */
import * as cheerio from 'cheerio'
import { fetchText, describeError, originOf } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { pickSample } from '../lib/sample.js'
import { reporter, summarize } from '../lib/findings.js'

/** Сколько вложенных карт разбирать. Больше — долго и обычно не нужно. */
const MAX_NESTED = 5

export async function checkSitemap(target, options = {}) {
  const { timeoutMs = 15000, limit = 50, sampleSize = 8 } = options
  const found = reporter()

  // Можно передать и адрес сайта, и адрес самой карты
  const sitemapUrl = /\.xml($|\?)/i.test(target) ? target : originOf(target) + 'sitemap.xml'

  let page
  try {
    page = await fetchText(sitemapUrl, { timeoutMs })
  } catch (error) {
    const message = describeError(error, timeoutMs)
    found.add('sitemap-error', { status: message })
    return { url: sitemapUrl, ok: false, error: message, findings: found.list(), summary: summarize(found.list()) }
  }

  if (!page.ok) {
    found.add(page.status === 404 ? 'sitemap-missing' : 'sitemap-error', { status: page.status })
    return {
      url: sitemapUrl,
      ok: false,
      status: page.status,
      findings: found.list(),
      summary: summarize(found.list()),
    }
  }

  const parsed = parseSitemap(page.body, sitemapUrl)
  let urls = parsed.urls
  const nested = []

  // Карта карт: заглядываем внутрь, чтобы вернуть настоящие адреса страниц
  if (parsed.type === 'sitemapindex') {
    for (const child of parsed.sitemaps.slice(0, MAX_NESTED)) {
      try {
        const childPage = await fetchText(child, { timeoutMs })
        if (!childPage.ok) {
          found.add('sitemap-nested-error', { url: child, status: childPage.status })
          continue
        }
        const childParsed = parseSitemap(childPage.body, child)
        nested.push({ url: child, count: childParsed.urls.length })
        urls = urls.concat(childParsed.urls)
      } catch {
        found.add('sitemap-nested-error', { url: child, status: 'нет ответа' })
      }
    }
    if (parsed.sitemaps.length > MAX_NESTED) {
      found.add('sitemap-nested-limited', { total: parsed.sitemaps.length, limit: MAX_NESTED })
    }
  }

  if (!urls.length) found.add('sitemap-empty')

  const withoutLastmod = urls.filter((item) => !item.lastmod).length
  if (urls.length && withoutLastmod === urls.length) found.add('sitemap-no-lastmod')

  const duplicates = urls.length - new Set(urls.map((item) => item.loc)).size
  if (duplicates > 0) found.add('sitemap-duplicates', { count: counted(duplicates, FORMS.address) })

  const origin = new URL(sitemapUrl).origin
  const foreign = urls.filter((item) => {
    try {
      return new URL(item.loc).origin !== origin
    } catch {
      return true
    }
  })
  if (foreign.length) found.add('sitemap-foreign', { count: counted(foreign.length, FORMS.address) })

  const withParams = urls.filter((item) => item.loc.includes('?')).length
  if (withParams) found.add('sitemap-params', { count: counted(withParams, FORMS.address) })

  if (page.body.length > 50 * 1024 * 1024) found.add('sitemap-too-big')
  if (urls.length > 50000) found.add('sitemap-too-many', { count: counted(urls.length, FORMS.address) })

  // Представительная выборка: по одной странице каждого типа, а не первые
  // подряд. Именно её стоит брать для дальнейшей поштучной проверки.
  const sample = pickSample(urls, { limit: sampleSize, origin: origin + '/' })

  // Адреса чужих доменов в подсчёте структуры не участвуют: иначе после
  // переезда сайта проверка решит, что у него плоский каталог.
  const ownGroups = sample.groups.filter((group) => !group.shape.startsWith('другой домен'))
  if (ownGroups.length === 1 && urls.length - foreign.length > 20) {
    found.add('sitemap-flat')
  }

  const findings = found.list()

  return {
    url: sitemapUrl,
    ok: true,
    status: page.status,
    type: parsed.type,
    total: urls.length,
    nested,
    pageTypes: sample.groups.slice(0, 12),
    sample: sample.pages,
    urls: urls.slice(0, limit).map((item) => item.loc),
    withoutLastmod,
    findings,
    summary: summarize(findings),
  }
}

/** Читает XML карты. cheerio в режиме xml не портит регистр тегов. */
function parseSitemap(body, baseUrl) {
  const $ = cheerio.load(body, { xml: true })

  const sitemaps = []
  $('sitemapindex > sitemap > loc').each((_, el) => {
    const value = $(el).text().trim()
    if (value) sitemaps.push(new URL(value, baseUrl).href)
  })

  const urls = []
  $('urlset > url').each((_, el) => {
    const loc = $(el).find('loc').first().text().trim()
    if (!loc) return
    urls.push({ loc, lastmod: $(el).find('lastmod').first().text().trim() || null })
  })

  return { type: sitemaps.length ? 'sitemapindex' : 'urlset', sitemaps, urls }
}
