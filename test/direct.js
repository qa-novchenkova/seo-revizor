/**
 * Прогон без модели на живом сайте.
 *
 *   node test/direct.js https://example.com/
 *
 * Ключ доступа к модели не нужен: это те же инструменты, только порядок
 * вызовов задан заранее. Отчёт складывается в reports/ рядом с прогонами агента.
 */
import { loadEnv } from '../src/lib/env.js'
import { runDirect } from '../src/direct.js'
import { toMarkdown, toHtml } from '../src/report.js'
import { saveRun, previousRun, compare } from '../src/store.js'
import { SEVERITY_LABELS, SEVERITIES } from '../src/rules/index.js'

loadEnv()

const site = process.argv[2]

if (!site) {
  console.log('\n  Использование: node test/direct.js https://example.com/\n')
  process.exit(1)
}

console.log(`\n  Проверка ${site} без модели\n`)

const started = Date.now()

const run = await runDirect(site, {
  onStep: (event) => {
    if (event.type === 'call') {
      const where = event.input?.url ? ' ' + event.input.url : ''
      process.stdout.write(`  → ${event.name}${where}`)
    }
    if (event.type === 'result') {
      console.log(event.ok ? '' : '   не отработал')
    }
  },
})

const previous = previousRun(site)
const diff = previous ? compare(run, previous) : null
const saved = saveRun(run, { md: toMarkdown(run, diff), html: toHtml(run, diff) })

const counts = {}
for (const finding of run.findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1
const parts = SEVERITIES.filter((level) => counts[level]).map(
  (level) => `${SEVERITY_LABELS[level]}: ${counts[level]}`,
)

console.log(`\n  Готово за ${Math.round((Date.now() - started) / 1000)} с`)
console.log(`  Вызовов: ${run.calls.length}, страниц: ${run.pages.length}`)
console.log(`  Находок: ${run.findings.length}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`)

if (diff) {
  console.log(`  С прошлой проверки: исправлено ${diff.fixed.length}, новых ${diff.appeared.length}`)
}

console.log(`\n  Отчёт: ${saved.files.md}\n`)
