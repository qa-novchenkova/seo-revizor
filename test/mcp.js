/**
 * Разговор с сервером напрямую, без Claude Code.
 *
 * Запускаем src/server.js как обычную программу и пишем ему в стандартный ввод
 * те же сообщения, которые послал бы настоящий клиент. Это позволяет увидеть
 * протокол своими глазами и убедиться, что сервер отвечает.
 *
 *   node test/mcp.js [адрес]
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const server = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
})

// сервер пишет отладку в stderr — показываем её отдельно
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
for (const tool of list.result.tools) {
  console.log(`   • ${tool.name} — ${tool.description.slice(0, 70)}…`)
  console.log(`     принимает: ${Object.keys(tool.inputSchema.properties || {}).join(', ')}`)
}

// ── 3. Вызов ─────────────────────────────────────────────────────────────────
const target = process.argv[2] || 'https://qa-novchenkova.github.io/studio/'
console.log(`\n3. Вызов check_url для ${target}`)
const answer = await send('tools/call', { name: 'check_url', arguments: { url: target } })
const data = JSON.parse(answer.result.content[0].text)

console.log('   код ответа:', data.status)
console.log('   редиректов:', data.redirects)
console.log('   замечаний: ', data.notes.length)
for (const note of data.notes) console.log('     •', note)

console.log('\nГотово. Сервер отвечает по протоколу.\n')
server.kill()
