/**
 * Проверка безопасности.
 *
 * Раздел, который в SEO-аудитах обычно пропускают, а он даёт заметные находки
 * и хорошо выглядит в отчёте. Всё делается обычными запросами: ничего не
 * подбирается, ничего не ломается, просто спрашиваем сервер о том,
 * что он и так отдаёт любому желающему.
 *
 * Проверять чужой сайт без разрешения владельца не нужно даже так.
 */
import tls from 'node:tls'

import * as cheerio from 'cheerio'
import { probe, fetchText, originOf } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/**
 * Служебные файлы, которые чаще всего забывают закрыть.
 * Список намеренно короткий: это не перебор, а проверка известных промахов.
 */
const SENSITIVE = [
  '.git/config',
  '.env',
  '.htaccess',
  'dump.sql',
  'backup.sql',
  'phpinfo.php',
  '.DS_Store',
  'composer.lock',
]

/** Папки, у которых проверяем, не открыт ли список файлов. */
const DIRECTORIES = ['uploads/', 'files/', 'images/', 'backup/', 'logs/']

/** До истечения сертификата меньше этого — уже повод беспокоиться. */
const CERT_WARN_DAYS = 21

export async function checkSecurity(siteUrl, options = {}) {
  const { timeoutMs = 15000 } = options
  const found = reporter()

  let origin
  try {
    origin = originOf(siteUrl)
  } catch {
    return { url: siteUrl, ok: false, error: 'Неверный адрес', findings: [], summary: {} }
  }

  const parsed = new URL(origin)

  // ── сертификат ────────────────────────────────────────────────────────────
  let certificate = null
  if (parsed.protocol === 'https:') {
    certificate = await readCertificate(parsed.hostname, timeoutMs)

    if (certificate.error) {
      found.add('cert-problem', { detail: certificate.error })
    } else if (certificate.daysLeft !== null && certificate.daysLeft < CERT_WARN_DAYS) {
      found.add('cert-expiring', {
        until: certificate.validTo,
        days: certificate.daysLeft > 0 ? counted(certificate.daysLeft, FORMS.day) : 'срок уже истёк',
      })
    }
  }

  // ── заголовки главной ─────────────────────────────────────────────────────
  const page = await safeFetch(origin, timeoutMs)
  const headers = {}
  const cookies = []

  if (page) {
    for (const [name, value] of page.headers) {
      if (name.toLowerCase() === 'set-cookie') cookies.push(value)
      else headers[name.toLowerCase()] = value
    }
    // getSetCookie отдаёт все cookie по отдельности, а не склеенными
    if (typeof page.headers.getSetCookie === 'function') {
      cookies.length = 0
      cookies.push(...page.headers.getSetCookie())
    }
  }

  if (headers['server'] && /\d/.test(headers['server'])) {
    found.add('server-version', { value: headers['server'] })
  }
  if (headers['x-powered-by']) {
    found.add('x-powered-by', { value: headers['x-powered-by'] })
  }
  if (parsed.protocol === 'https:' && !headers['strict-transport-security']) {
    found.add('no-hsts')
  }
  if (!headers['x-content-type-options']) {
    found.add('no-content-type-options')
  }
  if (!headers['x-frame-options'] && !/frame-ancestors/i.test(headers['content-security-policy'] || '')) {
    found.add('no-frame-protection')
  }
  if (!headers['referrer-policy']) {
    found.add('no-referrer-policy')
  }

  // ── cookie ────────────────────────────────────────────────────────────────
  const cookieProblems = { secure: [], httponly: [], samesite: [] }
  for (const raw of cookies) {
    const name = raw.split('=')[0].trim()
    if (!/;\s*secure/i.test(raw)) cookieProblems.secure.push(name)
    if (!/;\s*httponly/i.test(raw)) cookieProblems.httponly.push(name)
    if (!/;\s*samesite/i.test(raw)) cookieProblems.samesite.push(name)
  }

  const missingAttributes = Object.entries(cookieProblems)
    .filter(([, names]) => names.length)
    .map(([attribute]) => ({ secure: 'Secure', httponly: 'HttpOnly', samesite: 'SameSite' })[attribute])

  if (missingAttributes.length) {
    const names = [...new Set(Object.values(cookieProblems).flat())]
    found.add('cookie-insecure', {
      missing: missingAttributes.join(', '),
      names: names.slice(0, 5).join(', '),
    })
  }

  // ── смешанное содержимое ──────────────────────────────────────────────────
  const mixed = []
  if (page && page.ok && parsed.protocol === 'https:') {
    const $ = cheerio.load(page.body)
    $('script[src], link[href], img[src], iframe[src], source[src]').each((_, el) => {
      const value = $(el).attr('src') || $(el).attr('href') || ''
      if (/^http:\/\//i.test(value)) mixed.push(value.slice(0, 100))
    })
    if (mixed.length) {
      found.add('mixed-content', { count: mixed.length, examples: mixed.slice(0, 2).join(', ') })
    }
  }

  // ── служебные файлы ───────────────────────────────────────────────────────
  const exposed = []
  for (const path of SENSITIVE) {
    const result = await probe(origin + path, { timeoutMs })
    if (result.status === 200 && !result.throttled) {
      exposed.push(path)
      found.add('exposed-file', { path: '/' + path })
    }
  }

  // ── список файлов в папке ─────────────────────────────────────────────────
  const listings = []
  for (const directory of DIRECTORIES) {
    const listing = await safeFetch(origin + directory, timeoutMs)
    if (listing && listing.ok && looksLikeListing(listing.body)) {
      listings.push('/' + directory)
      found.add('directory-listing', { path: '/' + directory })
    }
  }

  // ── подробности ошибки ────────────────────────────────────────────────────
  const errorPage = await safeFetch(`${origin}revizor-proverka-oshibki-${Date.now()}`, timeoutMs)
  let errorHint = null
  if (errorPage) {
    errorHint = findErrorTrace(errorPage.body)
    if (errorHint) found.add('error-details', { hint: errorHint })
  }

  const findings = found.list()

  return {
    url: siteUrl,
    ok: true,
    origin,
    certificate,
    headers,
    cookies: cookies.length,
    cookieProblems,
    mixedContent: mixed.slice(0, 10),
    exposedFiles: exposed,
    directoryListings: listings,
    errorHint,
    findings,
    summary: summarize(findings),
  }
}

/** Читает сертификат напрямую по защищённому соединению. */
function readCertificate(hostname, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate()
        const authorized = socket.authorized
        const reason = socket.authorizationError
        socket.end()

        if (!cert || !cert.valid_to) {
          resolve({ error: 'Сертификат не удалось прочитать', daysLeft: null })
          return
        }

        const until = new Date(cert.valid_to)
        const daysLeft = Math.floor((until - Date.now()) / 86400000)

        resolve({
          issuer: cert.issuer?.O || cert.issuer?.CN || null,
          subject: cert.subject?.CN || null,
          validTo: until.toLocaleDateString('ru-RU'),
          daysLeft,
          error: authorized ? null : `Браузер не доверяет сертификату: ${reason}`,
        })
      },
    )

    socket.on('error', (error) => resolve({ error: `Не удалось установить защищённое соединение: ${error.message}`, daysLeft: null }))
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ error: 'Сервер не ответил на защищённое соединение', daysLeft: null })
    })
  })
}

/** Признаки страницы со списком файлов. */
function looksLikeListing(body) {
  return /<title>\s*Index of |Directory listing for |<h1>\s*Index of /i.test(body)
}

/** Ищет в теле ответа следы вывода ошибки: пути на сервере, трассировки, версии. */
function findErrorTrace(body) {
  const patterns = [
    [/(?:Fatal error|Warning|Notice|Parse error):[^<\n]{0,120}/i, 'сообщение PHP'],
    [/Stack trace:|Traceback \(most recent call last\)/i, 'трассировка вызовов'],
    [/[A-Z]:\\(?:[\w .-]+\\){2,}[\w .-]+\.(?:php|js|py|rb)/, 'путь к файлу на сервере'],
    [/\/(?:var|home|usr)\/(?:[\w.-]+\/){2,}[\w.-]+\.(?:php|js|py|rb)/, 'путь к файлу на сервере'],
    [/at [\w$.]+ \((?:\/|[A-Z]:\\)[^)]{10,}\)/, 'трассировка вызовов'],
  ]

  for (const [pattern, label] of patterns) {
    const match = body.match(pattern)
    if (match) return `${label} — «${match[0].trim().slice(0, 90)}»`
  }
  return null
}

async function safeFetch(url, timeoutMs) {
  try {
    return await fetchText(url, { timeoutMs })
  } catch {
    return null
  }
}
