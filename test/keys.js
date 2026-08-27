/**
 * Показывает, какие ключи подхватились, не раскрывая их.
 *
 *   node test/keys.js
 *
 * Печатается только начало и конец — этого хватает, чтобы убедиться,
 * что подставился нужный ключ, и недостаточно, чтобы им воспользоваться.
 * Такой вывод можно спокойно показать кому угодно.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, maskKey } from '../src/lib/env.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const envFile = path.join(root, '.env')

loadEnv()

console.log('')
console.log('  файл .env:', existsSync(envFile) ? 'найден' : 'НЕ найден — скопируйте .env.example в .env')
console.log('')

const KEYS = [
  ['PAGESPEED_KEY', 'измерение скорости', 'без него раздел скорости пропускается'],
  ['ANTHROPIC_API_KEY', 'своя версия агента', 'не нужен, если запускаете агента через Claude Code'],
  ['REVIZOR_MODEL', 'модель для агента', 'не задан — используется claude-opus-5'],
]

for (const [name, what, note] of KEYS) {
  const value = process.env[name]
  const shown = name === 'REVIZOR_MODEL' ? value || 'не задан' : maskKey(value)
  console.log(`  ${name.padEnd(20)} ${shown.padEnd(16)} ${what}`)
  if (!value) console.log(`  ${' '.repeat(20)} ${note}`)
}

console.log('')
console.log('  Ключи целиком нигде не печатаются и в репозиторий не попадают:')
console.log('  файл .env закрыт в .gitignore.')
console.log('')
