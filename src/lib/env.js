/**
 * Загрузка ключей из файла .env.
 *
 * Ключи не место в коде и тем более в переписке. Правильное место — файл .env
 * рядом с проектом, который закрыт в .gitignore и никогда не уезжает в репозиторий.
 *
 * Node умеет читать такой файл сам, сторонних библиотек не нужно.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

let loaded = false

/**
 * Читает .env из корня проекта, если он есть.
 * Переменные, уже заданные в окружении, имеют приоритет — так удобнее
 * подменять значения на один запуск.
 */
export function loadEnv() {
  if (loaded) return
  loaded = true

  // Тестам нужен чистый набор переменных: личный .env с кодами доступа
  // и потолками менял бы поведение по умолчанию, и проверить его было бы нечем.
  if (process.env.REVIZOR_SKIP_ENV) return

  const file = path.join(root, '.env')
  if (!existsSync(file)) return

  try {
    process.loadEnvFile(file)
  } catch (error) {
    console.error(`Не удалось прочитать .env: ${error.message}`)
  }
}

/**
 * Показывает ключ так, чтобы было понятно, какой именно, но нельзя было
 * им воспользоваться: AIza…7sbI. Для сообщений в консоли.
 */
export function maskKey(value) {
  if (!value) return 'не задан'
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}
