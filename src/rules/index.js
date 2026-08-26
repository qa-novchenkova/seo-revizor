/**
 * Реестр правил.
 *
 * Формулировки живут в JSON рядом, а не в коде проверок. Это даёт три вещи:
 *
 *   1. Текст замечания можно править, не трогая логику и не рискуя её сломать.
 *   2. У каждого правила есть постоянный идентификатор — по нему можно будет
 *      сравнить два прогона и понять, что починили, а что появилось.
 *   3. К правилу приложены объяснение «почему это плохо» и «что делать».
 *      Проверка возвращает только факт, объяснение подтягивается отсюда.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Уровни важности, от тяжёлого к лёгкому. Порядок задаёт сортировку в отчёте. */
export const SEVERITIES = ['critical', 'important', 'minor']

export const SEVERITY_LABELS = {
  critical: 'критично',
  important: 'важно',
  minor: 'мелочь',
}

const registry = new Map()

for (const file of readdirSync(here).filter((name) => name.endsWith('.json'))) {
  const raw = JSON.parse(readFileSync(path.join(here, file), 'utf8'))

  for (const rule of raw.rules) {
    if (registry.has(rule.id)) {
      throw new Error(`Правило «${rule.id}» объявлено дважды: ${file} и ${registry.get(rule.id).file}`)
    }
    if (!SEVERITIES.includes(rule.severity)) {
      throw new Error(`У правила «${rule.id}» неизвестная важность: ${rule.severity}`)
    }
    registry.set(rule.id, { ...rule, area: raw.area, file })
  }
}

export function getRule(id) {
  const rule = registry.get(id)
  if (!rule) throw new Error(`Правило «${id}» не найдено в реестре`)
  return rule
}

export function allRules() {
  return [...registry.values()]
}

/** Правила по областям, для показа списком. */
export function rulesByArea() {
  const areas = new Map()
  for (const rule of registry.values()) {
    if (!areas.has(rule.area)) areas.set(rule.area, [])
    areas.get(rule.area).push(rule)
  }
  return [...areas.entries()].map(([area, rules]) => ({
    area,
    total: rules.length,
    rules: rules
      .slice()
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
  }))
}
