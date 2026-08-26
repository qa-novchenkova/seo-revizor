/**
 * Запуск агента.
 *
 *   node test/audit.js https://example.com/
 *
 * В отличие от test/mcp.js, где порядок вызовов прописан руками,
 * здесь его выбирает модель. Каждый её ход печатается, чтобы цикл был виден.
 */
import { audit, consoleReporter } from '../src/agent.js'

const site = process.argv[2]

if (!site) {
  console.log('\n  Использование: node test/audit.js https://site.ru/\n')
  process.exit(1)
}

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log(`
  Нужен ключ доступа к модели: агент обращается к ней на каждом круге.

  Ключ берётся на console.anthropic.com, раздел API Keys.
  Дальше в терминале, в той же сессии:

    export ANTHROPIC_API_KEY=sk-ant-...      (Git Bash)
    $env:ANTHROPIC_API_KEY = "sk-ant-..."    (PowerShell)

  Один прогон стоит порядка нескольких центов. Модель можно сменить:

    export REVIZOR_MODEL=claude-haiku-4-5
`)
  process.exit(1)
}

console.log(`\n  Аудит ${site}`)
console.log('  ' + '─'.repeat(Math.min(76, Math.max(20, site.length + 8))) + '\n')

const started = Date.now()
const result = await audit(site, { onStep: consoleReporter() })
const seconds = ((Date.now() - started) / 1000).toFixed(1)

console.log('\n' + '═'.repeat(78))
console.log('  ОТЧЁТ')
console.log('═'.repeat(78) + '\n')
console.log(result.report)

console.log('\n' + '─'.repeat(78))
console.log(
  `  вызовов инструментов: ${result.calls.length} · время: ${seconds} с · ` +
    `токенов: ${result.usage.inputTokens} на вход, ${result.usage.outputTokens} на выход` +
    (result.usage.cost !== null ? ` · примерно $${result.usage.cost.toFixed(3)}` : ''),
)
if (result.stoppedBy === 'limit') {
  console.log('  остановлено по лимиту кругов: модель не успела дописать отчёт')
}
console.log('')
