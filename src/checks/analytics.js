/**
 * Аналитика: стоит ли счётчик, везде ли, не задвоен ли.
 *
 * Проверка простая, но без неё нельзя ответить на вопрос «что сработало».
 * А это отдельный пункт в требованиях: следить за метриками материалов.
 */
import { fetchText } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'
import { reporter, summarize } from '../lib/findings.js'

/**
 * Как узнать каждую систему в разметке страницы.
 * Ищем и по адресу скрипта, и по имени функции: код вставляют по-разному.
 */
const SYSTEMS = [
  { id: 'metrika', name: 'Яндекс.Метрика', src: /mc\.yandex\.ru\/metrika/i, inline: /\bym\(\s*\d+/ },
  { id: 'ga', name: 'Google Analytics', src: /googletagmanager\.com\/gtag\/js/i, inline: /\bgtag\(\s*['"]config/ },
  { id: 'gtm', name: 'Google Tag Manager', src: /googletagmanager\.com\/gtm\.js/i, inline: /\bGTM-[A-Z0-9]{4,}/ },
  { id: 'vk', name: 'Пиксель ВКонтакте', src: /vk\.com\/js\/api\/openapi/i, inline: /\bVK\.Retargeting/ },
  { id: 'mailru', name: 'Top.Mail.Ru', src: /top-fwz1\.mail\.ru\/js\/code/i, inline: /\b_tmr\.push/ },
]

/** Настройки Метрики, которые видно прямо в коде вставки. */
const WEBVISOR_HINTS = [/webvisor\s*:\s*true/i, /clickmap\s*:\s*true/i]

export async function checkAnalytics(target, options = {}) {
  const { timeoutMs = 15000, alsoCheck = [] } = options
  const found = reporter()

  let page
  try {
    page = await fetchText(target, { timeoutMs })
  } catch {
    return { url: target, ok: false, error: 'Страница не открылась', findings: [], summary: {} }
  }

  if (!page.ok) {
    return { url: target, ok: false, status: page.status, findings: [], summary: {} }
  }

  const detected = detect(page.body)

  if (!detected.length) {
    found.add('no-counter')
  }

  for (const system of detected) {
    if (system.count > 1) {
      found.add('counter-duplicated', { counter: system.name, count: system.count })
    }
    if (system.blocking) {
      found.add('counter-blocking', { counter: system.name })
    }
  }

  const metrika = detected.find((system) => system.id === 'metrika')
  if (metrika && !WEBVISOR_HINTS.some((pattern) => pattern.test(page.body))) {
    found.add('counter-no-webvisor')
  }

  // ── те же счётчики на других страницах ────────────────────────────────────
  const otherPages = []
  for (const url of alsoCheck.slice(0, 4)) {
    if (url === target) continue
    try {
      const other = await fetchText(url, { timeoutMs })
      if (!other.ok) continue
      otherPages.push({ url, systems: detect(other.body).map((system) => system.id) })
    } catch {
      // недоступная страница — не тема этой проверки
    }
  }

  for (const system of detected) {
    const missing = otherPages.filter((page) => !page.systems.includes(system.id))
    if (missing.length) {
      found.add('counter-missing-on-page', {
        counter: system.name,
        pages: missing.map((page) => shortPath(page.url)).slice(0, 3).join(', '),
      })
    }
  }

  const findings = found.list()

  return {
    url: target,
    ok: true,
    counters: detected.map((system) => ({
      name: system.name,
      count: system.count,
      blocking: system.blocking,
    })),
    checkedAlso: otherPages.map((page) => page.url),
    summaryLine: detected.length
      ? `найдено ${counted(detected.length, FORMS.counter)}`
      : 'счётчиков не найдено',
    findings,
    summary: summarize(findings),
  }
}

/**
 * Ищет системы аналитики в разметке.
 *
 * Считаем отдельно подключения файлом и следы кода прямо на странице:
 * счётчик вставляют и так, и так, а иногда обоими способами сразу.
 */
function detect(body) {
  const scripts = [...body.matchAll(/<script\b([^>]*)>/gi)].map((match) => {
    const attributes = match[1]
    const src = (attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || ''
    return { src, deferred: /\b(async|defer)\b/i.test(attributes) }
  })

  const result = []

  for (const system of SYSTEMS) {
    const tags = scripts.filter((script) => system.src.test(script.src))

    const inlineGlobal = new RegExp(system.inline.source, 'g')
    const inlineHits = (body.match(inlineGlobal) || []).length

    const count = Math.max(tags.length, tags.length ? tags.length : inlineHits ? 1 : 0)
    if (!count) continue

    result.push({
      id: system.id,
      name: system.name,
      count,
      // Синхронное подключение задерживает отрисовку страницы
      blocking: tags.some((tag) => !tag.deferred),
    })
  }

  return result
}

function shortPath(url) {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search || '/'
  } catch {
    return url
  }
}
