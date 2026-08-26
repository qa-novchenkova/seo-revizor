/**
 * Разговор с сервером напрямую, без Claude Code.
 *
 * Запускаем src/server.js как обычную программу и пишем ему в стандартный ввод
 * те же сообщения, которые послал бы настоящий клиент.
 *
 *   node test/mcp.js [адрес сайта]
 *
 * ВАЖНО: последовательность вызовов здесь прописана руками. Это ещё не агент.
 * Агент появится на следующем этапе: там порядок будет выбирать модель,
 * глядя на результат предыдущего шага.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { SEVERITY_LABELS as LABELS } from '../src/rules/index.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const server = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
})

server.stderr.on('data', (chunk) => process.stdout.write('  [сервер] ' + chunk.toString().trim() + '\n'))

// Сообщения разделяются переносом строки, каждое — одна строка JSON
let buffer = ''
const pending = new Map()

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue

    const message = JSON.parse(line)
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }
})

let counter = 0

function send(method, params) {
  const id = ++counter
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve) => pending.set(id, resolve))
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

/** Вызов инструмента: возвращает уже разобранный результат. */
async function call(name, args) {
  const answer = await send('tools/call', { name, arguments: args })
  if (answer.result.isError) {
    console.log('   ОШИБКА:', answer.result.content[0].text)
    return null
  }
  return JSON.parse(answer.result.content[0].text)
}

function showFindings(data, limit = 3) {
  const findings = data?.findings || []
  if (!findings.length) {
    console.log('   замечаний нет')
    return
  }
  for (const finding of findings.slice(0, limit)) {
    console.log(`   [${LABELS[finding.severity]}] ${finding.message}`)
  }
  if (findings.length > limit) console.log(`   … и ещё ${findings.length - limit}`)
}

// ── 1. Рукопожатие ───────────────────────────────────────────────────────────
console.log('\n1. Рукопожатие')
const hello = await send('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'ручная-проверка', version: '0' },
})
console.log('   сервер представился:', hello.result.serverInfo.name, hello.result.serverInfo.version)
notify('notifications/initialized')

// ── 2. Что ты умеешь ─────────────────────────────────────────────────────────
console.log('\n2. Список инструментов')
const list = await send('tools/list', {})
for (const item of list.result.tools) {
  console.log(`   • ${item.name.padEnd(14)} ${Object.keys(item.inputSchema.properties || {}).join(', ')}`)
}

// ── 3. Цепочка вызовов ───────────────────────────────────────────────────────
const site = process.argv[2] || 'https://vitejs.dev/'
console.log(`\n3. Разбор сайта ${site}`)

console.log('\n   шаг 1 — robots.txt')
const robots = await call('check_robots', { url: site })
console.log(`   существует: ${robots?.exists ? 'да' : 'нет'}, карт сайта в нём: ${robots?.sitemaps?.length ?? 0}`)
showFindings(robots)

console.log('\n   шаг 2 — карта сайта')
// Адрес карты берём из robots.txt, если он там указан. Именно так и работает
// цепочка: результат предыдущего шага определяет аргумент следующего.
const sitemapTarget = robots?.sitemaps?.[0] || site
const sitemap = await call('check_sitemap', { url: sitemapTarget, limit: 5 })
console.log(`   тип: ${sitemap?.type}, адресов: ${sitemap?.total}, типов страниц: ${sitemap?.pageTypes?.length ?? 0}`)
showFindings(sitemap)

// Адрес берём не первый попавшийся, а из представительной выборки: иначе
// на большом сайте проверим десять однотипных страниц подряд.
const picked = sitemap?.sample?.[1] || sitemap?.sample?.[0] || { url: site, shape: 'главная' }
console.log(`\n   шаг 3 — код ответа, тип страницы «${picked.shape}»`)
console.log(`   ${picked.url}`)
const url = await call('check_url', { url: picked.url })
console.log(`   код: ${url?.status}, редиректов: ${url?.redirects}`)
showFindings(url)

console.log(`\n   шаг 4 — мета-теги той же страницы`)
const meta = await call('check_meta', { url: picked.url })
console.log(`   title: ${meta?.title?.length ?? 0} симв., H1: ${meta?.h1?.length ?? 0}`)
showFindings(meta)

console.log('\nГотово. Все инструменты отвечают по протоколу.\n')
server.kill()
