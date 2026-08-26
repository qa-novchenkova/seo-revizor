/**
 * Проверка одного адреса: код ответа, цепочка редиректов, ключевые заголовки.
 *
 * Здесь НЕТ НИ СЛОВА про MCP. Это обычная функция: дали адрес — вернула данные.
 * Формулировок замечаний здесь тоже нет: проверка только фиксирует факт,
 * а текст берётся из реестра правил в src/rules.
 */
import { request, describeError } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/** Заголовки, которые интересны при аудите. Остальные не тащим, чтобы не засорять ответ. */
const INTERESTING_HEADERS = [
  'content-type',
  'last-modified',
  'server',
  'x-powered-by',
  'strict-transport-security',
  'content-encoding',
  'cache-control',
  'x-robots-tag',
]

/**
 * @param {string} url  полный адрес со схемой
 * @param {{maxHops?: number, timeoutMs?: number}} options
 */
export async function checkUrl(url, options = {}) {
  const { maxHops = 10, timeoutMs = 15000 } = options

  const startedAt = Date.now()
  const found = reporter()
  const chain = []
  let current = url

  try {
    for (let hop = 0; hop <= maxHops; hop++) {
      // redirect: 'manual' — ключевой момент. По умолчанию fetch сам проходит
      // все редиректы, и мы бы увидели только конечную страницу. А нам нужна
      // именно цепочка: сколько шагов и куда ведёт каждый.
      const response = await request(current, { timeoutMs, redirect: 'manual' })
      const location = response.headers.get('location')

      chain.push({
        url: current,
        status: response.status,
        location: location ? new URL(location, current).href : null,
      })

      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current).href

        if (chain.some((step) => step.url === next)) {
          found.add('redirect-loop')
          return build(url, chain, startedAt, null, found)
        }

        current = next
        continue
      }

      // дошли до конечной страницы
      const headers = {}
      for (const name of INTERESTING_HEADERS) {
        const value = response.headers.get(name)
        if (value) headers[name] = value
      }

      return build(url, chain, startedAt, headers, found)
    }

    found.add('redirect-too-many', { limit: counted(maxHops, FORMS.redirect) })
    return build(url, chain, startedAt, null, found)
  } catch (error) {
    const message = describeError(error, timeoutMs)
    found.add('url-unreachable', { error: message })

    return {
      url,
      ok: false,
      error: message,
      chain,
      responseMs: Date.now() - startedAt,
      findings: found.list(),
      summary: summarize(found.list()),
    }
  }
}

function build(requestedUrl, chain, startedAt, headers, found) {
  const last = chain[chain.length - 1] || {}
  const redirects = chain.length - 1

  if (headers) {
    if (redirects > 1) {
      found.add('redirect-chain', { count: counted(redirects, FORMS.redirect) })
    }
    if (last.status >= 400) {
      found.add('url-broken', { status: last.status })
    }
    if (last.status === 200 && !headers['last-modified']) {
      found.add('no-last-modified')
    }
    if (headers['server'] && /\d/.test(headers['server'])) {
      found.add('server-version', { value: headers['server'] })
    }
    if (headers['x-powered-by']) {
      found.add('x-powered-by', { value: headers['x-powered-by'] })
    }
    if (headers['x-robots-tag'] && /noindex/i.test(headers['x-robots-tag'])) {
      found.add('x-robots-noindex')
    }
    if (requestedUrl.startsWith('https://') && !headers['strict-transport-security']) {
      found.add('no-hsts')
    }
    if (!headers['content-encoding']) {
      found.add('no-compression')
    }
  }

  const findings = found.list()

  return {
    url: requestedUrl,
    ok: true,
    status: last.status ?? null,
    finalUrl: last.url ?? requestedUrl,
    redirects,
    chain,
    headers: headers || {},
    responseMs: Date.now() - startedAt,
    findings,
    summary: summarize(findings),
  }
}
