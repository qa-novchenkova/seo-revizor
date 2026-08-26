/**
 * Сбор находок.
 *
 * Проверка больше не пишет текст замечания сама. Она говорит: «сработало
 * правило redirect-chain, подставь сюда количество» — а формулировка,
 * важность и объяснение берутся из реестра правил.
 */
import { getRule, SEVERITIES } from '../rules/index.js'

/** Подставляет значения в шаблон: «Цепочка из {count}» + { count: '3 редиректа' }. */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
  )
}

/**
 * Возвращает копилку находок.
 *
 *   const found = reporter()
 *   found.add('no-canonical')
 *   found.add('redirect-chain', { count: '3 редиректа' })
 *   found.list()
 */
export function reporter() {
  const items = []

  return {
    /**
     * @param {string} id      идентификатор правила из реестра
     * @param {object} values  значения для подстановки в шаблон
     * @param {object} extra   дополнительные поля находки, например пример адреса
     */
    add(id, values = {}, extra = {}) {
      const rule = getRule(id)
      items.push({
        id: rule.id,
        severity: rule.severity,
        area: rule.area,
        title: rule.title,
        message: fill(rule.message, values),
        why: rule.why,
        fix: rule.fix,
        ...extra,
      })
      return this
    },

    /** Находки, отсортированные по важности: сначала критичное. */
    list() {
      return items
        .slice()
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
    },
  }
}

/** Сводка по важности: { critical: 1, important: 3, minor: 5 }. */
export function summarize(findings) {
  const counts = {}
  for (const severity of SEVERITIES) counts[severity] = 0
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}
