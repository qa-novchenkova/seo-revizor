/**
 * Проверка разбора ответа сервиса измерения — на записанных данных.
 *
 * Обращение к сервису идёт около минуты и тратит дневную квоту ключа,
 * поэтому логику проверяем на подготовленном ответе, а не живым запросом.
 *
 *   node test/speed.js
 */
import assert from 'node:assert/strict'
import { interpret } from '../src/checks/speed.js'

/** Ответ сервиса, урезанный до того, что мы читаем. */
const sample = {
  categories: { performance: { score: 0.85 } },
  audits: {
    'largest-contentful-paint': { numericValue: 4000, displayValue: '4.0 s' },
    'cumulative-layout-shift': { numericValue: 0 },
    'server-response-time': { numericValue: 40, displayValue: 'Root document took 40 ms' },
    'total-byte-weight': { numericValue: 3.2 * 1024 * 1024 },
    'largest-contentful-paint-element': {
      details: { items: [{ items: [{ node: { nodeLabel: 'Помощник по продвижению' } }] }] },
    },
    'render-blocking-resources': { score: 0.5, title: 'Устраните ресурсы, блокирующие отображение', details: { overallSavingsMs: 850 } },
    'modern-image-formats': { score: 0.3, title: 'Используйте современные форматы изображений', details: { overallSavingsBytes: 420 * 1024 } },
    'unused-javascript': { score: 0.4, title: 'Удалите неиспользуемый код JavaScript', details: { overallSavingsBytes: 180 * 1024 } },
    'uses-long-cache-ttl': { score: 0.6, title: 'Настройте эффективную политику кеширования', details: { overallSavingsBytes: 90 * 1024 } },
    'unsized-images': { score: 0, title: 'Изображения без размеров' },
    'lcp-lazy-loaded': { score: 0, title: 'Изображение LCP загружается отложенно' },
    'font-display': { score: 0.5, title: 'Убедитесь, что текст виден во время загрузки шрифта' },
    'dom-size': { score: 0.7, title: 'Слишком большой размер структуры DOM' },
    // Пройденные проверки не должны попадать в отчёт
    'uses-text-compression': { score: 1, title: 'Включите сжатие текста' },
    'redirects': { score: 1, title: 'Избегайте переадресаций' },
  },
}

console.log('\n  Проверка разбора ответа сервиса измерения\n')

const result = interpret(sample, 'mobile')
const ids = result.findings.map((finding) => finding.id)

// ── показатели ───────────────────────────────────────────────────────────────
assert.equal(result.score, 85, 'оценка должна читаться')
assert.equal(result.metrics.lcp, '4.0 с', 'LCP должен форматироваться нами, а не подписью сервиса')
assert.equal(result.metrics.ttfb, '40 мс', 'из «Root document took 40 ms» должно остаться только число')
assert.equal(result.metrics.total, '3.2 МБ', 'вес страницы должен переводиться в мегабайты')
console.log('  ✓ показатели читаются и форматируются по-человечески')

// ── находки ──────────────────────────────────────────────────────────────────
assert.ok(ids.includes('speed-score-medium'), 'оценка 85 — оранжевая зона')
assert.ok(!ids.includes('speed-score-low'), 'оценка 85 не должна считаться красной зоной')
assert.ok(ids.includes('lcp-slow'), 'LCP 4 секунды — находка')
assert.ok(!ids.includes('cls-high'), 'CLS ноль — не находка')
assert.ok(ids.includes('page-heavy'), '3,2 МБ — тяжёлая страница')
console.log('  ✓ пороги срабатывают там, где надо, и молчат где не надо')

// ── причина, а не только симптом ─────────────────────────────────────────────
assert.equal(result.lcpElement, 'Помощник по продвижению', 'должен определяться самый крупный элемент')
assert.ok(ids.includes('lcp-element'), 'при медленном LCP должно называться, что именно медленное')
assert.ok(ids.includes('lcp-image-lazy'), 'отложенная загрузка главной картинки — отдельная находка')
console.log('  ✓ называется не только симптом, но и причина')

// ── что тормозит ─────────────────────────────────────────────────────────────
assert.ok(result.opportunities.length >= 4, `список «что тормозит» не должен быть пустым, сейчас ${result.opportunities.length}`)
assert.equal(result.opportunities[0].id, 'modern-image-formats', 'первым идёт самая крупная потеря')
assert.ok(ids.includes('render-blocking'), 'блокирующие ресурсы должны попасть в находки')
assert.ok(ids.includes('images-heavy'), 'тяжёлые картинки должны попасть в находки')
assert.ok(!ids.some((id) => id === 'no-compression'), 'пройденная проверка сжатия не должна давать находку')
console.log(`  ✓ список «что тормозит» собран: ${result.opportunities.length} шт., крупнейший первым`)

// ── мелочи ───────────────────────────────────────────────────────────────────
assert.ok(result.diagnostics.length >= 2, 'мелочи должны собираться списком')
assert.ok(!result.diagnostics.some((title) => title.includes('переадресаций')), 'пройденные пункты в список не идут')
console.log('  ✓ мелочи собраны отдельным списком, пройденное отброшено')

// ── пустой ответ не должен ломать разбор ─────────────────────────────────────
const empty = interpret({ categories: { performance: { score: 1 } }, audits: {} })
assert.equal(empty.findings.length, 0, 'идеальный сайт не должен давать находок')
assert.equal(empty.score, 100)
console.log('  ✓ ответ без замечаний не ломает разбор')

console.log(`\n  Разбор работает. Находок на образце: ${result.findings.length}.\n`)
