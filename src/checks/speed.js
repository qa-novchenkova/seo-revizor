/**
 * Скорость и Core Web Vitals.
 *
 * Мерить скорость самостоятельно нельзя: нужен настоящий браузер, эмуляция
 * медленной сети и слабого телефона. Всё это уже делает бесплатный сервис
 * PageSpeed Insights — берём цифры оттуда.
 *
 * Нужен бесплатный ключ в переменной PAGESPEED_KEY: без него общая квота
 * сервиса кончается за минуты, потому что она одна на всех безымянных.
 */
import { reporter, summarize } from '../lib/findings.js'

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

/** Пороги Core Web Vitals — те же, по которым оценивают поисковые системы. */
const LIMITS = { lcp: 2500, cls: 0.1, inp: 200, ttfb: 800 }

/** Вес страницы, после которого стоит бить тревогу. */
const HEAVY_PAGE_BYTES = 2 * 1024 * 1024

/**
 * Пороги упоминания. Занижены намеренно: при первой версии на сайте
 * с оценкой 85 и четырьмя секундами LCP список «что тормозит» вышел пустым,
 * то есть отчёт называл проблему и не подсказывал причину.
 */
const WORTH_MENTION_MS = 100
const WORTH_MENTION_BYTES = 20 * 1024

/** Что именно проверяем и к какому правилу это относится. */
const OPPORTUNITIES = [
  ['render-blocking-resources', 'render-blocking', 'ms'],
  ['render-blocking-insight', 'render-blocking', 'ms'],
  ['modern-image-formats', 'images-heavy', 'bytes'],
  ['uses-optimized-images', 'images-heavy', 'bytes'],
  ['image-delivery-insight', 'images-heavy', 'bytes'],
  ['uses-responsive-images', 'images-oversized', 'bytes'],
  ['unused-css-rules', 'unused-code', 'bytes'],
  ['unused-javascript', 'unused-code', 'bytes'],
  ['legacy-javascript', 'unused-code', 'bytes'],
  ['duplicated-javascript', 'unused-code', 'bytes'],
  ['uses-long-cache-ttl', 'no-cache-headers', 'bytes'],
  ['cache-insight', 'no-cache-headers', 'bytes'],
  ['uses-text-compression', 'no-compression', 'bytes'],
  ['mainthread-work-breakdown', 'main-thread-busy', 'ms'],
  ['bootup-time', 'main-thread-busy', 'ms'],
  ['third-party-summary', 'third-party-heavy', 'ms'],
]

/** Пункты, которые просто перечисляем списком, без отдельного правила на каждый. */
const DIAGNOSTIC_IDS = [
  'uses-rel-preconnect',
  'font-display',
  'redirects',
  'critical-request-chains',
  'dom-size',
  'efficient-animated-content',
  'prioritize-lcp-image',
  'lcp-lazy-loaded',
  'network-dependency-tree-insight',
  'forced-reflow-insight',
]

export async function checkSpeed(url, options = {}) {
  const { strategy = 'mobile', timeoutMs = 90000 } = options
  const found = reporter()
  const key = process.env.PAGESPEED_KEY

  if (!key) {
    found.add('speed-no-key')
    return {
      url,
      ok: false,
      needsKey: true,
      error: 'Нет ключа PAGESPEED_KEY — скорость не измерялась',
      hint:
        'Ключ бесплатный: console.cloud.google.com → включить PageSpeed Insights API → создать ключ. ' +
        'Дальше положить его в переменную PAGESPEED_KEY.',
      findings: found.list(),
      summary: summarize(found.list()),
    }
  }

  const request =
    `${ENDPOINT}?url=${encodeURIComponent(url)}&strategy=${strategy}` +
    `&category=performance&key=${key}`

  let data
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) {
      const text = await response.text()
      let detail = text.slice(0, 160)
      try {
        detail = JSON.parse(text).error?.message || detail
      } catch {
        // ответ не в JSON — оставляем как есть
      }
      return {
        url,
        ok: false,
        error: `Сервис измерения ответил ${response.status}: ${detail}`,
        hint:
          response.status === 400
            ? 'Скорее всего ключ неверный или у него стоят ограничения, под которые этот запрос не подходит.'
            : null,
        findings: [],
        summary: {},
      }
    }
    data = await response.json()
  } catch (error) {
    return { url, ok: false, error: `Сервис измерения не ответил: ${error.message}`, findings: [], summary: {} }
  }

  const lighthouse = data.lighthouseResult
  if (!lighthouse) {
    return { url, ok: false, error: 'Сервис вернул ответ без результатов измерения', findings: [], summary: {} }
  }

  return { url, ...interpret(lighthouse, strategy) }
}

/**
 * Разбор ответа сервиса вынесен отдельно, чтобы его можно было проверить
 * на записанных данных: обращение к сервису идёт минуту и тратит квоту.
 */
export function interpret(lighthouse, strategy = 'mobile') {
  const found = reporter()
  const device = strategy === 'mobile' ? 'мобильных' : 'десктопе'
  const audits = lighthouse.audits || {}
  const score = Math.round((lighthouse.categories?.performance?.score ?? 0) * 100)

  // ── общая оценка ──────────────────────────────────────────────────────────
  if (score < 50) found.add('speed-score-low', { device, score })
  else if (score < 90) found.add('speed-score-medium', { device, score })

  // ── основные показатели ───────────────────────────────────────────────────
  const metrics = {
    lcp: metric(audits['largest-contentful-paint'], 'ms'),
    cls: metric(audits['cumulative-layout-shift'], 'raw'),
    inp: metric(audits['interaction-to-next-paint'], 'ms'),
    ttfb: metric(audits['server-response-time'], 'ms'),
    total: metric(audits['total-byte-weight'], 'bytes'),
  }

  if (over(metrics.lcp, LIMITS.lcp)) found.add('lcp-slow', { device, value: metrics.lcp.display })
  if (over(metrics.cls, LIMITS.cls)) found.add('cls-high', { device, value: metrics.cls.display })
  if (over(metrics.inp, LIMITS.inp)) found.add('inp-slow', { device, value: metrics.inp.display })
  if (over(metrics.ttfb, LIMITS.ttfb)) found.add('ttfb-slow', { device, value: metrics.ttfb.display })
  if (over(metrics.total, HEAVY_PAGE_BYTES)) found.add('page-heavy', { value: metrics.total.display })

  // ── что именно является самым крупным элементом ───────────────────────────
  const lcpElement = describeLcpElement(audits)
  if (lcpElement && over(metrics.lcp, LIMITS.lcp)) {
    found.add('lcp-element', { element: lcpElement })
  }

  if (failed(audits['lcp-lazy-loaded']) || failed(audits['prioritize-lcp-image'])) {
    found.add('lcp-image-lazy')
  }

  // ── что тормозит ──────────────────────────────────────────────────────────
  const reported = new Set()
  const details = []

  for (const [auditId, ruleId, unit] of OPPORTUNITIES) {
    const audit = audits[auditId]
    if (!audit || audit.score === null || audit.score >= 0.9) continue

    const saving = savingOf(audit, unit)
    const enough = unit === 'ms' ? saving >= WORTH_MENTION_MS : saving >= WORTH_MENTION_BYTES
    if (!enough) continue

    details.push({ id: auditId, title: audit.title, saving, unit })
    if (reported.has(ruleId)) continue

    reported.add(ruleId)
    found.add(ruleId, { value: unit === 'ms' ? formatMs(saving) : formatBytes(saving) })
  }

  if (failed(audits['unsized-images'])) found.add('no-image-dimensions')

  // ── мелочи списком ────────────────────────────────────────────────────────
  const diagnostics = DIAGNOSTIC_IDS.map((id) => audits[id])
    .filter((audit) => audit && audit.score !== null && audit.score < 0.9)
    .map((audit) => audit.title)

  if (diagnostics.length) {
    found.add('speed-diagnostics', { list: diagnostics.slice(0, 6).join('; ') })
  }

  const findings = found.list()

  return {
    ok: true,
    strategy,
    score,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([name, item]) => [name, item ? item.display : null]),
    ),
    lcpElement,
    opportunities: details.sort((a, b) => b.saving - a.saving).slice(0, 12),
    diagnostics,
    findings,
    summary: summarize(findings),
  }
}

/**
 * Берёт число из результата измерения и форматирует сами.
 *
 * Готовая подпись сервиса иногда выглядит как «Root document took 40 ms» —
 * в отчёт такое ставить нельзя.
 */
function metric(audit, unit) {
  if (!audit || audit.numericValue === undefined || audit.numericValue === null) return null

  const value = audit.numericValue
  const display =
    unit === 'ms' ? formatMs(value) : unit === 'bytes' ? formatBytes(value) : String(Math.round(value * 1000) / 1000)

  return { value, display }
}

function over(item, limit) {
  return item && item.value !== null && item.value > limit
}

function failed(audit) {
  return Boolean(audit) && audit.score !== null && audit.score < 0.9
}

function savingOf(audit, unit) {
  const details = audit.details || {}
  if (unit === 'ms') {
    return details.overallSavingsMs ?? details.summary?.wastedMs ?? audit.numericValue ?? 0
  }
  return details.overallSavingsBytes ?? details.summary?.wastedBytes ?? audit.numericValue ?? 0
}

/** Достаёт описание самого крупного элемента первого экрана. */
function describeLcpElement(audits) {
  const audit = audits['largest-contentful-paint-element']
  const items = audit?.details?.items || []

  for (const item of items) {
    const node = item.node || item.items?.[0]?.node
    if (!node) continue
    const label = node.nodeLabel || node.snippet || node.selector
    if (label) return String(label).replace(/\s+/g, ' ').slice(0, 120)
  }
  return null
}

function formatMs(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} с` : `${Math.round(value)} мс`
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`
  return `${Math.round(value / 1024)} КБ`
}
