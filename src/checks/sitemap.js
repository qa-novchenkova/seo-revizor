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

/** Сколько вложенных карт разбирать. Больше — долго и обычно не нужно. */
const MAX_NESTED = 5

export async function checkSitemap(target, options = {}) {
  const { timeoutMs = 15000, limit = 50 } = options

  // Можно передать и адрес сайта, и адрес самой карты
  const sitemapUrl = /\.xml($|\?)/i.test(target) ? target : originOf(target) + 'sitemap.xml'

  let page
  try {
    page = await fetchText(sitemapUrl, { timeoutMs })
  } catch (error) {
    return {
      url: sitemapUrl,
      ok: false,
      error: describeError(error, timeoutMs),
      notes: ['Карта сайта не запрашивается.'],
    }
  }

  if (!page.ok) {
    return {
      url: sitemapUrl,
      ok: false,
      status: page.status,
      notes: [
        page.status === 404
          ? 'Карты сайта нет по стандартному адресу. Проверьте директиву Sitemap в robots.txt.'
          : `Карта сайта отдала ${page.status}.`,
      ],
    }
  }

  const parsed = parseSitemap(page.body, sitemapUrl)
  const notes = []
  let urls = parsed.urls
  const nested = []

  // Карта карт: заглядываем внутрь, чтобы вернуть настоящие адреса страниц
  if (parsed.type === 'sitemapindex') {
    for (const child of parsed.sitemaps.slice(0, MAX_NESTED)) {
      try {
        const childPage = await fetchText(child, { timeoutMs })
        if (!childPage.ok) {
          notes.push(`Вложенная карта ${child} отдала ${childPage.status}.`)
          continue
        }
        const childParsed = parseSitemap(childPage.body, child)
        nested.push({ url: child, count: childParsed.urls.length })
        urls = urls.concat(childParsed.urls)
      } catch {
        notes.push(`Вложенная карта ${child} не открылась.`)
      }
    }
    if (parsed.sitemaps.length > MAX_NESTED) {
      notes.push(
        `Вложенных карт ${parsed.sitemaps.length}, разобраны первые ${MAX_NESTED}. ` +
          'Остальные пропущены, чтобы не затягивать проверку.',
      )
    }
  }

  // ── замечания ─────────────────────────────────────────────────────────────
  if (!urls.length) {
    notes.push('В карте нет ни одного адреса.')
  }

  const withoutLastmod = urls.filter((item) => !item.lastmod).length
  if (urls.length && withoutLastmod === urls.length) {
    notes.push('Ни у одного адреса нет даты изменения. Поисковику труднее понять, что переобходить.')
  }

  const duplicates = urls.length - new Set(urls.map((item) => item.loc)).size
  if (duplicates > 0) {
    notes.push(`В карте повторяется ${counted(duplicates, FORMS.address)}.`)
  }

  const origin = new URL(sitemapUrl).origin
  const foreign = urls.filter((item) => {
    try {
      return new URL(item.loc).origin !== origin
    } catch {
      return true
    }
  })
  if (foreign.length) {
    notes.push(
      `В карте ${counted(foreign.length, FORMS.address)} с другого домена. ` +
        'Такие записи поисковик проигнорирует.',
    )
  }

  const withParams = urls.filter((item) => item.loc.includes('?')).length
  if (withParams) {
    notes.push(
      `В карте ${counted(withParams, FORMS.address)} с параметрами в строке. ` +
        'Обычно это дубли основных страниц, им в карте не место.',
    )
  }

  if (page.body.length > 50 * 1024 * 1024) {
    notes.push('Файл карты больше 50 МБ — превышен лимит поисковых систем.')
  }
  if (urls.length > 50000) {
    notes.push(
      `В карте ${counted(urls.length, FORMS.address)}, лимит одной карты — 50 000. ` +
        'Нужно разбить на несколько и собрать их в карту карт.',
    )
  }

  return {
    url: sitemapUrl,
    ok: true,
    status: page.status,
    type: parsed.type,
    total: urls.length,
    nested,
    urls: urls.slice(0, limit).map((item) => item.loc),
    withoutLastmod,
    notes,
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
    urls.push({
      loc,
      lastmod: $(el).find('lastmod').first().text().trim() || null,
    })
  })

  return {
    type: sitemaps.length ? 'sitemapindex' : 'urlset',
    sitemaps,
    urls,
  }
}
