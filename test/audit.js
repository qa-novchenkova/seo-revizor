/**
 * Запуск агента и сборка отчёта.
 *
 *   node test/audit.js https://example.com/
 *
 * В отличие от test/mcp.js, где порядок вызовов прописан руками,
 * здесь его выбирает модель. Каждый её ход печатается, чтобы цикл был виден.
 *
 * После прогона собираются документы: Markdown, HTML и PDF. Если по этому
 * сайту уже был прогон, добавляется раздел «что изменилось».
 */

import { loadEnv } from '../src/lib/env.js'
import { audit, consoleReporter } from '../src/agent.js'
import { toMarkdown, toHtml } from '../src/report.js'
import { saveRun, previousRun, compare } from '../src/store.js'
import { htmlToPdf, findBrowser } from '../src/pdf.js'
import { SEVERITY_LABELS, SEVERITIES } from '../src/rules/index.js'

// Ключи берём из .env, если он есть рядом с проектом
loadEnv()

const site = process.argv[2]

if (!site) {
  console.log('\n  Использование: node test/audit.js https://site.ru/\n')
  process.exit(1)
}

const hasKey =
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AI_GATEWAY_KEY

if (!hasKey) {
  console.log(`
  Нужен ключ доступа к модели: агент обращается к ней на каждом круге.

  Путь первый — напрямую у Anthropic. Ключ берётся на console.anthropic.com,
  раздел API Keys, и кладётся в .env:

    ANTHROPIC_API_KEY=sk-ant-...

  Путь второй — через OpenAI-совместимый шлюз, счёт в рублях:

    AI_GATEWAY_KEY=...
    AI_GATEWAY_URL=https://api.timeweb.ai/v1
    REVIZOR_MODEL=anthropic/claude-haiku-4-5

  Проверить цикл без ключа и бесплатно: npm run loop
  Проверить сайт без модели: node test/direct.js https://site.ru/
`)
  process.exit(1)
}

console.log(`\n  Аудит ${site}`)
console.log('  ' + '─'.repeat(Math.min(76, Math.max(20, site.length + 8))) + '\n')

const started = Date.now()
const result = await audit(site, { onStep: consoleReporter() })
const seconds = ((Date.now() - started) / 1000).toFixed(1)

// ── отчёт ────────────────────────────────────────────────────────────────────
const previous = previousRun(site, result.finishedAt)
const diff = compare(result, previous)

const saved = saveRun(result, {
  md: toMarkdown(result, diff),
  html: toHtml(result, diff),
})

console.log('\n' + '═'.repeat(78))
console.log('  ОТЧЁТ')
console.log('═'.repeat(78) + '\n')
console.log(result.report)

const counts = {}
for (const level of SEVERITIES) counts[level] = 0
for (const finding of result.findings) counts[finding.severity] += 1

console.log('\n' + '─'.repeat(78))
console.log(
  `  находок: ${result.findings.length} (` +
    SEVERITIES.filter((level) => counts[level])
      .map((level) => `${SEVERITY_LABELS[level]}: ${counts[level]}`)
      .join(', ') +
    ')',
)

if (diff) {
  console.log(
    `  с прошлой проверки: исправлено ${diff.fixed.length}, ` +
      `появилось ${diff.appeared.length}, осталось ${diff.stayed.length}`,
  )
}

console.log(
  `  вызовов: ${result.calls.length} · время: ${seconds} с · ` +
    `токенов: ${result.usage.inputTokens} на вход, ${result.usage.outputTokens} на выход` +
    (result.usage.cost !== null ? ` · примерно $${result.usage.cost.toFixed(3)}` : ''),
)

if (result.stoppedBy === 'limit') {
  console.log('  остановлено по лимиту кругов: модель не успела дописать отчёт')
}

// ── печать в PDF ─────────────────────────────────────────────────────────────
console.log('\n  файлы:')
console.log(`    ${saved.files.md}`)
console.log(`    ${saved.files.html}`)

if (findBrowser()) {
  const pdfPath = `${saved.base}.pdf`
  const printed = await htmlToPdf(saved.files.html, pdfPath)
  console.log(printed.ok ? `    ${pdfPath}` : `    PDF не собрался: ${printed.reason}`)
} else {
  console.log('    PDF пропущен: не найден Chrome или Edge. Откройте HTML и напечатайте в PDF из браузера.')
}

console.log('')
