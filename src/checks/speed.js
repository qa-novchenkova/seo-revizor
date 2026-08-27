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

/** Сколько потерь на пункте считаем достойным упоминания, в миллисекундах и байтах. */
const WORTH_MENTION_MS = 300
const WORTH_MENTION_BYTES = 100 * 1024

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
      return {
        url,
        ok: false,
        error: `Сервис измерения ответил ${response.status}: ${text.slice(0, 200)}`,
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

  const device = strategy === 'mobile' ? 'мобильных' : 'десктопе'
  const audits = lighthouse.audits || {}
  const score = Math.round((lighthouse.categories?.performance?.score ?? 0) * 100)

  // ── общая оценка ──────────────────────────────────────────────────────────
  if (score < 50) found.add('speed-score-low', { device, score })
  else if (score < 90) found.add('speed-score-medium', { device, score })

  // ── основные показатели ───────────────────────────────────────────────────
  const metrics = {
    lcp: pick(audits['largest-contentful-paint']),
    cls: pick(audits['cumulative-layout-shift']),
    inp: pick(audits['interaction-to-next-paint']) || pick(audits['experimental-interaction-to-next-paint']),
    ttfb: pick(audits['server-response-time']),
  }

  if (over(metrics.lcp, LIMITS.lcp)) found.add('lcp-slow', { device, value: metrics.lcp.display })
  if (over(metrics.cls, LIMITS.cls)) found.add('cls-high', { device, value: metrics.cls.display })
  if (over(metrics.inp, LIMITS.inp)) found.add('inp-slow', { device, value: metrics.inp.display })
  if (over(metrics.ttfb, LIMITS.ttfb)) found.add('ttfb-slow', { device, value: metrics.ttfb.display })

  // ── что именно тормозит ───────────────────────────────────────────────────
  const opportunities = [
    ['render-blocking-resources', 'render-blocking', 'ms'],
    ['modern-image-formats', 'images-heavy', 'bytes'],
    ['uses-optimized-images', 'images-heavy', 'bytes'],
    ['uses-responsive-images', 'images-oversized', 'bytes'],
    ['unused-css-rules', 'unused-code', 'bytes'],
    ['unused-javascript', 'unused-code', 'bytes'],
    ['uses-long-cache-ttl', 'no-cache-headers', 'bytes'],
  ]

  const reported = new Set()
  const details = []

  for (const [auditId, ruleId, unit] of opportunities) {
    const audit = audits[auditId]
    if (!audit || audit.score === 1 || audit.score === null) continue

    const saving =
      unit === 'ms'
        ? audit.details?.overallSavingsMs ?? audit.numericValue ?? 0
        : audit.details?.overallSavingsBytes ?? audit.numericValue ?? 0

    const enough = unit === 'ms' ? saving >= WORTH_MENTION_MS : saving >= WORTH_MENTION_BYTES
    if (!enough) continue

    details.push({ id: auditId, title: audit.title, saving, unit })
    if (reported.has(ruleId)) continue

    reported.add(ruleId)
    found.add(ruleId, { value: unit === 'ms' ? formatMs(saving) : formatBytes(saving) })
  }

  if (audits['unsized-images'] && audits['unsized-images'].score === 0) {
    found.add('no-image-dimensions')
  }

  const findings = found.list()

  return {
    url,
    ok: true,
    strategy,
    score,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([name, metric]) => [name, metric ? metric.display : null]),
    ),
    opportunities: details.sort((a, b) => b.saving - a.saving).slice(0, 10),
    findings,
    summary: summarize(findings),
  }
}

function pick(audit) {
  if (!audit) return null
  return { value: audit.numericValue ?? null, display: audit.displayValue || String(audit.numericValue ?? '') }
}

function over(metric, limit) {
  return metric && metric.value !== null && metric.value > limit
}

function formatMs(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} с` : `${Math.round(value)} мс`
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`
  return `${Math.round(value / 1024)} КБ`
}
