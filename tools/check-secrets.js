/**
 * Проверка, что рабочие значения не попали в репозиторий.
 *
 * Ошибку легко сделать по невнимательности: заменяешь в примере одно слово
 * на другое и не замечаешь, что второе — настоящий код доступа. Человек такое
 * пропускает, машина нет.
 *
 * Проверяются две вещи:
 *   1. Значения из вашего .env — не встречаются ли они в отслеживаемых файлах.
 *   2. Узнаваемые формы секретов: ключи Google и Anthropic, токен бота,
 *      числовые идентификаторы Telegram.
 *
 *   npm run secrets
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * Значения, которые обязаны быть в документации: адреса сервисов и имена
 * моделей секретами не являются, и ругаться на них незачем.
 */
const PUBLIC_VALUES = [/^https?:\/\//, /^anthropic\//, /^claude-/]

/** Узнаваемые формы секретов: ищутся независимо от того, есть ли .env. */
const SHAPES = [
  ['ключ Google', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['ключ Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['токен телеграм-бота', /\b\d{9,10}:[A-Za-z0-9_-]{35}\b/],
  ['идентификатор Telegram', /(?:TELEGRAM_ADMINS|TELEGRAM_ALLOWED_USERS)\s*=\s*['"]?(\d{7,})/],
]

/**
 * Явная заглушка: 123456789, 000000000 и подобное. Такие числа в примерах
 * нужны и ругаться на них не за что.
 */
function looksFake(digits) {
  if (/^(\d)\1+$/.test(digits)) return true
  return '1234567890'.includes(digits) || '0987654321'.includes(digits)
}

function trackedFiles() {
  return execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('package-lock.json'))
}

/** Значения из .env, которые имеет смысл искать: короткие дают ложные срабатывания. */
function secretsFromEnv() {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .flatMap((line) => {
      const [name, ...rest] = line.split('=')
      const value = rest.join('=').trim()
      if (!value || value.length < 4) return []
      if (PUBLIC_VALUES.some((shape) => shape.test(value))) return []

      // Список кодов доступа проверяем по каждому слову отдельно.
      const parts = name.trim() === 'BOT_ACCESS_CODE' ? value.split(',') : [value]

      return parts
        .map((part) => part.split(':')[0].trim())
        .filter((part) => part.length >= 4)
        .map((part) => ({ name: name.trim(), value: part }))
    })
}

const files = trackedFiles()
const secrets = secretsFromEnv()
const problems = []

for (const file of files) {
  let text
  try {
    text = readFileSync(path.join(root, file), 'utf8')
  } catch {
    continue // двоичные файлы пропускаем
  }

  for (const { name, value } of secrets) {
    if (text.includes(value)) problems.push(`${file}: значение переменной ${name}`)
  }

  for (const [what, shape] of SHAPES) {
    const hit = text.match(shape)
    if (!hit) continue
    if (hit[1] && looksFake(hit[1])) continue
    problems.push(`${file}: похоже на ${what}`)
  }
}

console.log(`\n  Проверено файлов: ${files.length}`)
console.log(`  Значений из .env для сверки: ${secrets.length}\n`)

if (problems.length) {
  console.error('  РАБОЧИЕ ЗНАЧЕНИЯ В РЕПОЗИТОРИИ:\n')
  for (const problem of new Set(problems)) console.error(`    ${problem}`)
  console.error('\n  Замените их на выдуманные образцы, а сам секрет смените:')
  console.error('  всё, что попало в историю коммитов, считается известным всем.\n')
  process.exit(1)
}

console.log('  Рабочих значений в отслеживаемых файлах нет.\n')
