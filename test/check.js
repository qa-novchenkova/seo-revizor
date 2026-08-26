/**
 * Запуск проверки НАПРЯМУЮ, без модели и без протокола.
 *
 * Это первое, чем стоит пользоваться при разработке: если функция здесь
 * работает неправильно, через MCP она правильнее не станет.
 *
 *   node test/check.js https://example.com/
 */
import { checkUrl } from '../src/checks/url.js'

const target = process.argv[2] || 'https://example.com/'
const result = await checkUrl(target)

console.log('\n  ' + target)
console.log('  ' + '─'.repeat(Math.max(20, target.length)))

if (!result.ok) {
  console.log('  не открылся:', result.error)
} else {
  console.log(`  код ответа       ${result.status}`)
  console.log(`  редиректов       ${result.redirects}`)
  console.log(`  время ответа     ${result.responseMs} мс`)

  if (result.redirects > 0) {
    console.log('\n  цепочка:')
    for (const step of result.chain) {
      console.log(`    ${String(step.status).padEnd(4)} ${step.url}${step.location ? '\n         → ' + step.location : ''}`)
    }
  }

  console.log('\n  заголовки:')
  for (const [name, value] of Object.entries(result.headers)) {
    console.log(`    ${name.padEnd(28)} ${value}`)
  }
}

if (result.notes.length) {
  console.log('\n  замечания:')
  for (const note of result.notes) console.log(`    • ${note}`)
} else {
  console.log('\n  замечаний нет')
}
console.log('')
