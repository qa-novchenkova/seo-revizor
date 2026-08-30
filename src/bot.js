/**
 * Телеграм-бот: присылаешь адрес сайта — получаешь отчёт.
 *
 * Бот не делает проверок сам. Он только принимает адрес, запускает того же
 * агента, что и `npm run audit`, и отдаёт результат файлом. Вся логика
 * остаётся в src/agent.js и в инструментах сервера.
 *
 * Отдельной библиотеки для Telegram здесь нет намеренно. Всё общение с ним —
 * это обычные HTTP-запросы, а нужны ровно четыре метода. Ради них тянуть
 * зависимость, которую потом придётся обновлять, смысла нет.
 *
 * Запуск:
 *   npm run bot
 *
 * Нужны две переменные в .env:
 *   TELEGRAM_BOT_TOKEN  — выдаёт @BotFather
 *   ANTHROPIC_API_KEY   — ключ доступа к модели
 */
import { pathToFileURL } from 'node:url'

import { loadEnv } from './lib/env.js'
import { audit } from './agent.js'
import { toMarkdown } from './report.js'
import { saveRun, previousRun, compare } from './store.js'
import { SEVERITY_LABELS, SEVERITIES } from './rules/index.js'

loadEnv()

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API = `https://api.telegram.org/bot${TOKEN}`

/**
 * Ограничения. Каждая проверка стоит денег и занимает несколько минут,
 * поэтому бот без них превращается в способ потратить чужой бюджет.
 */
const LIMITS = {
  perDay: Number(process.env.BOT_DAILY_LIMIT || 5),
  cooldownMs: Number(process.env.BOT_COOLDOWN_MINUTES || 2) * 60_000,
  queue: Number(process.env.BOT_QUEUE_LIMIT || 5),
}

/** Если список задан, проверки доступны только этим пользователям. */
const ALLOWED = (process.env.TELEGRAM_ALLOWED_USERS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

/** Кому показывать расход токенов. */
const ADMINS = (process.env.TELEGRAM_ADMINS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

const HELLO = [
  'Это Ревизор — технический аудит сайта.',
  '',
  'Пришлите адрес, например: https://example.com',
  '',
  'Проверка занимает несколько минут. По ходу работы я буду показывать,',
  'что именно смотрю, а в конце пришлю отчёт файлом.',
  '',
  'Команды: /help — что проверяется, /limits — сколько проверок осталось.',
].join('\n')

const HELP = [
  'Что проверяется:',
  '',
  '· зеркала и дубли адресов: www, http, слэш, технические копии главной',
  '· robots.txt и карта сайта',
  '· мета-теги, заголовки, canonical, микроразметка',
  '· внутренние ссылки: битые, через переадресацию, без текста',
  '· безопасность: сертификат, заголовки, cookie, служебные файлы',
  '· аналитика: счётчики на страницах, дубли, синхронная загрузка',
  '· контент: дубли текста, пустые страницы, расхождения в контактах',
  '· скорость и Core Web Vitals',
  '',
  'Полный чек-лист: https://qa-novchenkova.github.io/seo-revizor/',
].join('\n')

// ── состояние ────────────────────────────────────────────────────────────────

/** Что пользователь уже потратил: счётчик на сутки и время прошлого запуска. */
const usage = new Map()

/** Очередь заданий. Проверки идут по одной: параллельные упрутся в лимиты сайта. */
const queue = []
let working = false

// ── запуск ───────────────────────────────────────────────────────────────────

/**
 * Опрос сервера Telegram. Вынесен в функцию, чтобы файл можно было
 * импортировать в тестах, не поднимая бота: как и у сервера, запуск
 * происходит только при прямом вызове `node src/bot.js`.
 */
export async function start() {
  if (!TOKEN) {
    console.error('Нет TELEGRAM_BOT_TOKEN. Получите токен у @BotFather и положите его в .env')
    process.exit(1)
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Нет ANTHROPIC_API_KEY. Без него агент не сможет обратиться к модели.')
    process.exit(1)
  }

  const me = await call('getMe')
  console.log(`Бот @${me.username} запущен. Остановить: Ctrl+C`)

  let offset = 0
  let alive = true

  process.on('SIGINT', () => {
    alive = false
    console.log('\nОстанавливаюсь…')
  })

  while (alive) {
    let updates = []

    try {
      // Длинное ожидание: запрос висит до 30 секунд и возвращается сразу,
      // как только придёт сообщение. Так не нужно опрашивать сервер вхолостую.
      updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] })
    } catch (error) {
      console.error('Не удалось получить обновления:', error.message || error)
      await sleep(3000)
      continue
    }

    for (const update of updates) {
      offset = update.update_id + 1
      if (update.message) handleMessage(update.message).catch(reportFailure)
    }
  }
}

// ── разбор сообщений ─────────────────────────────────────────────────────────

async function handleMessage(message) {
  const chatId = message.chat.id
  const userId = String(message.from?.id || chatId)
  const text = (message.text || '').trim()

  if (!text) return

  if (text.startsWith('/start')) return void (await send(chatId, HELLO))
  if (text.startsWith('/help')) return void (await send(chatId, HELP))
  if (text.startsWith('/limits')) return void (await send(chatId, limitsFor(userId)))

  const site = parseSite(text)
  if (!site) {
    return void (await send(chatId, 'Нужен адрес сайта целиком, например https://example.com'))
  }

  if (ALLOWED.length && !ALLOWED.includes(userId)) {
    return void (await send(chatId, 'Бот работает в закрытом режиме. Проверки доступны не всем.'))
  }

  const denial = checkLimits(userId)
  if (denial) return void (await send(chatId, denial))

  if (queue.length >= LIMITS.queue) {
    return void (await send(chatId, 'Очередь заполнена, попробуйте через несколько минут.'))
  }

  spend(userId)
  queue.push({ chatId, userId, site })

  const ahead = queue.length - 1
  const notice = await send(
    chatId,
    ahead ? `Принято: ${site}\nВ очереди перед вами: ${ahead}` : `Принято: ${site}\nНачинаю проверку.`,
  )

  runQueue(notice)
}

/** Достаёт адрес сайта из сообщения. */
export function parseSite(text) {
  const raw = text.split(/\s+/).find((word) => /^https?:\/\//i.test(word) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(word))
  if (!raw) return null

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!url.hostname.includes('.')) return null
    return url.origin + (url.pathname === '/' ? '/' : url.pathname)
  } catch {
    return null
  }
}

// ── ограничения ──────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

function stateOf(userId) {
  const state = usage.get(userId)
  if (state && state.day === today()) return state

  const fresh = { day: today(), count: 0, lastAt: 0 }
  usage.set(userId, fresh)
  return fresh
}

export function checkLimits(userId) {
  const state = stateOf(userId)

  if (state.count >= LIMITS.perDay) {
    return `На сегодня проверки закончились: ${LIMITS.perDay} в сутки. Счётчик обнулится завтра.`
  }

  const wait = state.lastAt + LIMITS.cooldownMs - Date.now()
  if (wait > 0) {
    return `Следующую проверку можно запустить через ${Math.ceil(wait / 60_000)} мин.`
  }

  return null
}

export function spend(userId) {
  const state = stateOf(userId)
  state.count += 1
  state.lastAt = Date.now()
}

/** Сброс счётчиков — нужен тестам, чтобы прогоны не влияли друг на друга. */
export function resetLimits() {
  usage.clear()
}

function limitsFor(userId) {
  const state = stateOf(userId)
  const left = Math.max(0, LIMITS.perDay - state.count)
  return `Проверок осталось сегодня: ${left} из ${LIMITS.perDay}.\nПауза между запусками: ${Math.round(LIMITS.cooldownMs / 60_000)} мин.`
}

// ── очередь ──────────────────────────────────────────────────────────────────

async function runQueue(notice) {
  if (working) return
  working = true

  while (queue.length) {
    const job = queue.shift()
    try {
      await runAudit(job, notice)
    } catch (error) {
      console.error('Проверка упала:', error)
      await send(job.chatId, `Проверка не завершилась: ${error.message || error}`)
    }
    notice = null
  }

  working = false
}

async function runAudit(job, notice) {
  const { chatId, userId, site } = job
  const started = Date.now()

  const progress = notice || (await send(chatId, `Начинаю проверку: ${site}`))
  const done = []
  let lastEdit = 0

  const show = async (force = false) => {
    // Telegram не любит частых правок сообщения, поэтому не чаще раза в две секунды
    if (!force && Date.now() - lastEdit < 2000) return
    lastEdit = Date.now()

    const lines = [`Проверяю ${site}`, '', ...done.slice(-8).map((line) => '· ' + line)]
    await edit(chatId, progress.message_id, lines.join('\n')).catch(() => {})
  }

  const result = await audit(site, {
    onStep: (event) => {
      if (event.type === 'call') {
        done.push(describeCall(event))
        show()
      }
    },
  })

  const minutes = Math.max(1, Math.round((Date.now() - started) / 60_000))
  done.push(`готово за ${minutes} мин`)
  await show(true)

  // ── отчёт ────────────────────────────────────────────────────────────────
  const previous = previousRun(site)
  const diff = previous ? compare(result, previous) : null
  const markdown = toMarkdown(result, diff)
  saveRun(result, { md: markdown })

  await sendDocument(chatId, markdown, fileNameFor(site), summary(result, diff))

  if (ADMINS.includes(userId) && result.usage.cost !== null) {
    await send(
      chatId,
      `Расход: ${result.usage.inputTokens} + ${result.usage.outputTokens} токенов, ` +
        `примерно $${result.usage.cost.toFixed(2)}. Вызовов инструментов: ${result.calls.length}.`,
    )
  }

  console.log(`${site}: находок ${result.findings.length}, вызовов ${result.calls.length}`)
}

/** Короткая строка о том, что сейчас делает агент. */
export function describeCall(event) {
  const names = {
    check_url: 'код ответа',
    check_meta: 'мета-теги',
    check_robots: 'robots.txt',
    check_sitemap: 'карта сайта',
    check_links: 'ссылки',
    check_mirrors: 'зеркала',
    check_security: 'безопасность',
    check_analytics: 'аналитика',
    check_content: 'контент и дубли',
    check_speed: 'скорость',
    list_rules: 'чек-лист',
  }

  const what = names[event.name] || event.name
  const where = event.input?.url ? ` — ${short(event.input.url)}` : ''
  return what + where
}

/** Итог проверки одним сообщением: без него придётся открывать файл ради цифры. */
export function summary(result, diff) {
  const counts = {}
  for (const finding of result.findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1

  const parts = SEVERITIES.filter((level) => counts[level]).map(
    (level) => `${SEVERITY_LABELS[level]}: ${counts[level]}`,
  )

  const lines = [
    `Отчёт по ${result.site}`,
    result.findings.length ? `Найдено ${result.findings.length} (${parts.join(', ')})` : 'Замечаний нет',
  ]

  if (diff) {
    lines.push(`С прошлой проверки: исправлено ${diff.fixed.length}, новых ${diff.added.length}`)
  }

  if (result.stoppedBy === 'limit') {
    lines.push('Проверка остановлена по лимиту шагов: разобраны не все разделы.')
  }

  return lines.join('\n')
}

function fileNameFor(site) {
  const host = safeHost(site)
  return `revizor-${host}-${new Date().toISOString().slice(0, 10)}.md`
}

function safeHost(site) {
  try {
    return new URL(site).hostname.replace(/[^a-z0-9.-]/gi, '-')
  } catch {
    return 'site'
  }
}

function short(url) {
  try {
    const parsed = new URL(url)
    const tail = parsed.pathname === '/' ? '' : parsed.pathname
    return parsed.hostname + (tail.length > 24 ? tail.slice(0, 23) + '…' : tail)
  } catch {
    return url
  }
}

// ── общение с Telegram ───────────────────────────────────────────────────────

async function call(method, payload = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    // Длинное ожидание висит до 30 секунд, поэтому запас сверху
    signal: AbortSignal.timeout(60_000),
  })

  const data = await response.json()
  if (!data.ok) throw new Error(`${method}: ${data.description || response.status}`)
  return data.result
}

function send(chatId, text) {
  return call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true })
}

function edit(chatId, messageId, text) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  })
}

/** Отчёт уходит файлом: в сообщение он не помещается, лимит около 4000 знаков. */
async function sendDocument(chatId, content, fileName, caption) {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('caption', caption.slice(0, 1000))
  form.append('document', new Blob([content], { type: 'text/markdown' }), fileName)

  const response = await fetch(`${API}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000),
  })

  const data = await response.json()
  if (!data.ok) throw new Error(`sendDocument: ${data.description || response.status}`)
  return data.result
}

function reportFailure(error) {
  console.error('Сбой при разборе сообщения:', error)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Поднимаемся только при прямом запуске: `node src/bot.js`.
// При импорте ради проверок бот молчит.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await start()
  process.exit(0)
}
