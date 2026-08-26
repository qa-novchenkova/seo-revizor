/**
 * Проверка robots.txt.
 *
 * Самая частая катастрофа после релиза: на боевой сайт уезжает тестовый
 * robots.txt с полным запретом, и сайт исчезает из поиска за сутки.
 */
import { fetchText, describeError, originOf } from '../lib/http.js'
import { reporter, summarize } from '../lib/findings.js'

export async function checkRobots(siteUrl, options = {}) {
  const { timeoutMs = 15000 } = options
  const found = reporter()

  const robotsUrl = originOf(siteUrl) + 'robots.txt'

  let page
  try {
    page = await fetchText(robotsUrl, { timeoutMs })
  } catch (error) {
    const message = describeError(error, timeoutMs)
    found.add('robots-error', { status: message })
    return { url: robotsUrl, ok: false, error: message, findings: found.list(), summary: summarize(found.list()) }
  }

  if (page.status === 404) {
    found.add('robots-missing')
    const findings = found.list()
    return {
      url: robotsUrl,
      ok: true,
      exists: false,
      status: 404,
      groups: [],
      sitemaps: [],
      findings,
      summary: summarize(findings),
    }
  }

  if (!page.ok) {
    found.add('robots-error', { status: page.status })
    return {
      url: robotsUrl,
      ok: false,
      status: page.status,
      exists: false,
      findings: found.list(),
      summary: summarize(found.list()),
    }
  }

  const parsed = parseRobots(page.body)

  const everyone = parsed.groups.find((group) => group.userAgents.includes('*'))
  if (everyone && everyone.disallow.includes('/')) {
    found.add('robots-disallow-all')
  }

  if (!parsed.sitemaps.length) found.add('robots-no-sitemap')
  if (!parsed.groups.length) found.add('robots-empty')

  const blockedAssets = (everyone?.disallow || []).filter((entry) =>
    /\.(css|js)$|\/(css|js|assets|static|bitrix|wp-content)\//i.test(entry),
  )
  if (blockedAssets.length) {
    found.add('robots-blocks-assets', { paths: blockedAssets.slice(0, 3).join(', ') })
  }

  if (page.body.length > 32 * 1024) found.add('robots-too-big')

  const findings = found.list()

  return {
    url: robotsUrl,
    ok: true,
    exists: true,
    status: page.status,
    size: page.body.length,
    groups: parsed.groups,
    sitemaps: parsed.sitemaps,
    crawlDelay: parsed.crawlDelay,
    findings,
    summary: summarize(findings),
  }
}

/**
 * Разбор robots.txt.
 * Несколько строк User-agent подряд означают одну группу правил
 * на всех перечисленных роботов — это место, где наивный разбор ошибается.
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
