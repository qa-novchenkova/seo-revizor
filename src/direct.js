/**
 * Проверка без модели.
 *
 * Тот же набор инструментов и тот же порядок, что задан агенту в AGENT.md,
 * только последовательность здесь жёстко прописана, а не выбирается моделью.
 * Ключ доступа к модели не нужен, и прогон ничего не стоит.
 *
 * Чем это отличается от агента:
 *
 *   агент   — сам решает, что смотреть дальше, и может углубиться туда,
 *             где заметил странность; пишет связный отчёт словами
 *   прогон  — идёт по списку от начала до конца; отчёт собирается
 *             из находок, без объяснений от модели
 *
 * Находки при этом одинаковые: их выдают инструменты, а не модель.
 * Поэтому сравнение прогонов между собой работает и здесь.
 *
 *   npm run direct https://example.com/
 */
import { checkMirrors } from './checks/mirrors.js'
import { checkRobots } from './checks/robots.js'
import { checkSitemap } from './checks/sitemap.js'
import { checkUrl } from './checks/url.js'
import { checkMeta } from './checks/meta.js'
import { checkLinks } from './checks/links.js'
import { checkSecurity } from './checks/security.js'
import { checkAnalytics } from './checks/analytics.js'
import { checkContent } from './checks/content.js'
import { checkSpeed } from './checks/speed.js'
import { SEVERITIES } from './rules/index.js'

/**
 * Сколько страниц проверяем поштучно: главная плюс образцы из выборки.
 *
 * Пять, а не три, потому что без модели порядок задан заранее и добрать
 * страницу по ходу некому. Каждая страница добавляет два вызова и пару секунд,
 * денег не стоит вовсе. Больше упрётся в размер выборки: по ссылкам их пять,
 * по карте сайта восемь.
 */
const PAGES_TO_CHECK = 5

export async function runDirect(site, options = {}) {
  const { onStep = () => {} } = options

  const findings = new Map()
  const calls = []
  const pages = new Set([site])

  /** Один шаг: выполнить проверку, собрать находки, сообщить наружу. */
  async function step(name, input, run) {
    onStep({ type: 'call', name, input })

    try {
      const result = await run()
      calls.push({ name, input, ok: true })
      collect(result, findings)
      onStep({ type: 'result', name, ok: true })
      return result
    } catch (error) {
      calls.push({ name, input, ok: false })
      onStep({ type: 'result', name, ok: false, text: String(error.message || error) })
      return null
    }
  }

  // ── 1. зеркала: пока сайт двоится, остальное бессмысленно ─────────────────
  await step('check_mirrors', { url: site }, () => checkMirrors(site))

  // ── 2. robots.txt: там самые тяжёлые ошибки ────────────────────────────────
  const robots = await step('check_robots', { url: site }, () => checkRobots(site))

  // ── 3. карта сайта, а если её нет — структура по ссылкам с главной ────────
  const mapAddress = robots?.sitemaps?.[0] || site
  const sitemap = await step('check_sitemap', { url: mapAddress }, () => checkSitemap(mapAddress))

  // ── 4. ссылки с главной ───────────────────────────────────────────────────
  // Идут до поштучных проверок намеренно: на сайте без карты только отсюда
  // и можно узнать, какие страницы вообще есть.
  const links = await step('check_links', { url: site }, () => checkLinks(site))

  // Выборка: по одной странице каждого типа. Сначала карта сайта, если она
  // есть; иначе внутренние ссылки с главной. Совсем без выборки проверять
  // было бы нечего, кроме самой главной.
  const fromMap = (sitemap?.sample || []).map((page) => page.url).filter(Boolean)
  const sample = (fromMap.length ? fromMap : links?.internal?.sample || []).filter(
    (url) => url !== site,
  )

  const chosen = [site, ...sample].slice(0, PAGES_TO_CHECK)
  for (const url of chosen) pages.add(url)

  // ── 5. коды ответа и мета-теги выбранных страниц ──────────────────────────
  for (const url of chosen) {
    await step('check_url', { url }, () => checkUrl(url))
    await step('check_meta', { url }, () => checkMeta(url))
  }

  // ── 6. безопасность: одного вызова на сайт достаточно ─────────────────────
  await step('check_security', { url: site }, () => checkSecurity(site))

  // ── 7. аналитика: главная плюс соседние страницы ──────────────────────────
  await step('check_analytics', { url: site }, () =>
    checkAnalytics(site, { alsoCheck: chosen.slice(1) }),
  )

  // ── 8. контент: работает только на наборе страниц ─────────────────────────
  const forContent = [site, ...sample].slice(0, 6)
  if (forContent.length > 1) {
    await step('check_content', { urls: forContent }, () => checkContent(forContent))
    for (const url of forContent) pages.add(url)
  }

  // ── 9. скорость: пропускается сама, если нет ключа ────────────────────────
  await step('check_speed', { url: site }, () => checkSpeed(site))

  const collected = [...findings.values()].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  )

  return {
    site,
    model: 'без модели',
    finishedAt: new Date().toISOString(),
    report: describe(collected, calls),
    findings: collected,
    pages: [...pages],
    calls,
    stoppedBy: 'end_turn',
    // Стоимости нет, а не «ноль»: обращений к модели не было вовсе,
    // и строка «примерно $0.00» только сбивала бы с толку.
    usage: { inputTokens: 0, outputTokens: 0, cost: null },
  }
}

/**
 * Складывает находки в общий список.
 * Ключ — правило плюс адрес: одно и то же замечание на разных страницах
 * должно остаться двумя строками, а на одной странице не задваиваться.
 */
function collect(result, findings) {
  if (!result) return

  const where = result.url || (Array.isArray(result.urls) ? result.urls[0] : '') || ''

  for (const finding of result.findings || []) {
    const key = `${finding.id}@${where}`
    if (!findings.has(key)) findings.set(key, { ...finding, url: where })
  }
}

/** Короткое описание вместо связного отчёта, который писала бы модель. */
function describe(findings, calls) {
  if (!findings.length) {
    return `Проверка прошла без замечаний. Выполнено вызовов: ${calls.length}.`
  }

  const counts = {}
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1

  const parts = SEVERITIES.filter((level) => counts[level]).map((level) => `${level}: ${counts[level]}`)

  return [
    `Проверка выполнена без модели: инструменты вызывались по заранее заданному порядку.`,
    `Найдено замечаний: ${findings.length} (${parts.join(', ')}). Вызовов: ${calls.length}.`,
    `Разбор каждой находки — ниже: что обнаружено, чем вредит, как исправить.`,
  ].join('\n\n')
}
