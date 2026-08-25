/**
 * Разговор с сервером напрямую, без Claude Code.
 *
 * Запускаем src/server.js как обычную программу и пишем ему в стандартный ввод
 * те же сообщения, которые послал бы настоящий клиент. Это позволяет увидеть
 * протокол своими глазами и убедиться, что сервер отвечает.
 *
 *   node test/mcp.js
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const корень = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const сервер = spawn(process.execPath, [path.join(корень, 'src', 'server.js')], {
  cwd: корень,
  stdio: ['pipe', 'pipe', 'pipe'],
})

// сервер пишет отладку в stderr — покажем её отдельно
сервер.stderr.on('data', (b) => process.stdout.write('  [сервер] ' + b.toString().trim() + '\n'))

// Сообщения разделяются переносом строки, каждое — одна строка JSON
let буфер = ''
const ожидание = new Map()
сервер.stdout.on('data', (b) => {
  буфер += b.toString()
  let i
  while ((i = буфер.indexOf('\n')) >= 0) {
    const строка = буфер.slice(0, i).trim()
    буфер = буфер.slice(i + 1)
    if (!строка) continue
    const сообщение = JSON.parse(строка)
    const ждущий = ожидание.get(сообщение.id)
    if (ждущий) {
      ожидание.delete(сообщение.id)
      ждущий(сообщение)
    }
  }
})

let счётчик = 0
function запрос(method, params) {
  const id = ++счётчик
  сервер.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((разрешить) => ожидание.set(id, разрешить))
}
function уведомление(method, params) {
  сервер.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

// ── 1. Рукопожатие ───────────────────────────────────────────────────────────
console.log('\n1. Рукопожатие')
const привет = await запрос('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'ручная-проверка', version: '0' },
})
console.log('   сервер представился:', привет.result.serverInfo.name, привет.result.serverInfo.version)
уведомление('notifications/initialized')

// ── 2. Что ты умеешь ─────────────────────────────────────────────────────────
console.log('\n2. Список инструментов')
const список = await запрос('tools/list', {})
for (const и of список.result.tools) {
  console.log(`   • ${и.name} — ${и.description.slice(0, 70)}…`)
  console.log(`     принимает: ${Object.keys(и.inputSchema.properties || {}).join(', ')}`)
}

// ── 3. Вызов ─────────────────────────────────────────────────────────────────
const цель = process.argv[2] || 'https://qa-novchenkova.github.io/studio/'
console.log(`\n3. Вызов check_url для ${цель}`)
const ответ = await запрос('tools/call', { name: 'check_url', arguments: { url: цель } })
const данные = JSON.parse(ответ.result.content[0].text)
console.log('   код ответа:', данные.код)
console.log('   редиректов:', данные.редиректов)
console.log('   замечаний: ', данные.замечания.length)
for (const з of данные.замечания) console.log('     •', з)

console.log('\nГотово. Сервер отвечает по протоколу.\n')
сервер.kill()
