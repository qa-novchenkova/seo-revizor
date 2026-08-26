/**
 * Проверка robots.txt.
 *
 * Самая частая катастрофа после релиза: на боевой сайт уезжает тестовый
 * robots.txt с полным запретом, и сайт исчезает из поиска за сутки.
 * Поэтому проверка отдельным инструментом и с явным замечанием.
 */
import { fetchText, describeError, originOf } from '../lib/http.js'

export async function checkRobots(siteUrl, options = {}) {
  const { timeoutMs = 15000 } = options

  const origin = originOf(siteUrl)
  const robotsUrl = origin + 'robots.txt'

  let page
  try {
    page = await fetchText(robotsUrl, { timeoutMs })
  } catch (error) {
    return {
      url: robotsUrl,
      ok: false,
      error: describeError(error, timeoutMs),
      notes: ['robots.txt не удалось запросить.'],
    }
  }

  if (page.status === 404) {
    return {
      url: robotsUrl,
      ok: true,
      exists: false,
      status: 404,
      groups: [],
      sitemaps: [],
      notes: [
        'robots.txt отсутствует. Формально это не запрещено, но тогда нельзя ни закрыть служебные разделы, ни указать карту сайта.',
      ],
    }
  }

  if (!page.ok) {
    return {
      url: robotsUrl,
      ok: false,
      status: page.status,
      exists: false,
      notes: [`robots.txt отдал ${page.status}. Роботы не смогут прочитать правила.`],
    }
  }

  const parsed = parseRobots(page.body)
  const notes = []

  const everyone = parsed.groups.find((group) => group.userAgents.includes('*'))
  if (everyone && everyone.disallow.includes('/')) {
    notes.push(
      'КРИТИЧНО: в robots.txt стоит «Disallow: /» для всех роботов. Сайт закрыт от индексации целиком. ' +
        'Чаще всего это тестовый файл, случайно выложенный на боевой сервер.',
    )
  }

  if (!parsed.sitemaps.length) {
    notes.push('В robots.txt не указана директива Sitemap. Поисковику труднее найти карту сайта.')
  }

  if (!parsed.groups.length) {
    notes.push('В robots.txt нет ни одной группы правил. Файл есть, но ничего не задаёт.')
  }

  const blockedAssets = (everyone?.disallow || []).filter((path) =>
    /\.(css|js)$|\/(css|js|assets|static|bitrix|wp-content)\//i.test(path),
  )
  if (blockedAssets.length) {
    notes.push(
      `Закрыты ресурсы оформления: ${blockedAssets.slice(0, 3).join(', ')}. ` +
        'Робот не увидит страницу так, как её видит человек, и может решить, что вёрстка сломана.',
    )
  }

  if (page.body.length > 32 * 1024) {
    notes.push('robots.txt больше 32 КБ. Поисковики читают его не целиком.')
  }

  return {
    url: robotsUrl,
    ok: true,
    exists: true,
    status: page.status,
    size: page.body.length,
    groups: parsed.groups,
    sitemaps: parsed.sitemaps,
    crawlDelay: parsed.crawlDelay,
    notes,
  }
}

/**
 * Разбор robots.txt.
 * Строки группируются по User-agent: несколько User-agent подряд означают
 * одну группу правил на всех перечисленных роботов.
 */
function parseRobots(body) {
  const groups = []
  const sitemaps = []
  let current = null
  let expectingAgents = false
  let crawlDelay = null

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line) continue

    const colon = line.indexOf(':')
    if (colon < 0) continue

    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { userAgents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.userAgents.push(value.toLowerCase())
      expectingAgents = true
      continue
    }

    if (field === 'sitemap') {
      sitemaps.push(value)
      continue
    }

    if (field === 'crawl-delay') {
      crawlDelay = value
      continue
    }

    if (!current) continue
    expectingAgents = false

    if (field === 'disallow') current.disallow.push(value)
    if (field === 'allow') current.allow.push(value)
  }

  return { groups, sitemaps, crawlDelay }
}
