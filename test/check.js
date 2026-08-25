/**
 * Запуск проверки НАПРЯМУЮ, без модели и без протокола.
 *
 * Это первое, чем стоит пользоваться при разработке: если функция здесь
 * работает неправильно, через MCP она правильнее не станет.
 *
 *   node test/check.js https://example.com/
 */
import { checkUrl } from '../src/checks/url.js'

const адрес = process.argv[2] || 'https://example.com/'
const р = await checkUrl(адрес)

console.log('\n  ' + адрес)
console.log('  ' + '─'.repeat(Math.max(20, адрес.length)))

if (!р.доступен) {
  console.log('  не открылся:', р.ошибка)
} else {
  console.log(`  код ответа       ${р.код}`)
  console.log(`  редиректов       ${р.редиректов}`)
  console.log(`  время ответа     ${р.мсОтвета} мс`)
  if (р.редиректов > 0) {
    console.log('\n  цепочка:')
    for (const з of р.цепочка) {
      console.log(`    ${String(з.код).padEnd(4)} ${з.адрес}${з.ведёт ? '\n         → ' + з.ведёт : ''}`)
    }
  }
  console.log('\n  заголовки:')
  for (const [к, v] of Object.entries(р.заголовки)) {
    console.log(`    ${к.padEnd(28)} ${v}`)
  }
}

if (р.замечания.length) {
  console.log('\n  замечания:')
  for (const з of р.замечания) console.log(`    • ${з}`)
} else {
  console.log('\n  замечаний нет')
}
console.log('')
