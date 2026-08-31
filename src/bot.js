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
import { runDirect } from './direct.js'
import { toMarkdown } from './report.js'
import { saveRun, previousRun, compare } from './store.js'
import { SEVERITY_LABELS, SEVERITIES } from './rules/index.js'

loadEnv()

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API = `https://api.telegram.org/bot${TOKEN}`

const SITE = 'https://qa-novchenkova.github.io/seo-revizor/'

/**
 * Есть ли доступ к модели.
 *
 * Без ключа бот не отказывается работать, а переключается на прогон
 * по заранее заданному порядку: те же инструменты, те же находки,
 * только шаги выбирает не модель. Появится ключ — включится агент,
 * менять в боте ничего не придётся.
 */
const HAS_MODEL = Boolean(process.env.ANTHROPIC_API_KEY)

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
  'Ревизор — технический аудит сайта.',
  '',
  'Пришлите адрес, например: https://example.com',
  '',
  'По ходу работы я показываю, что именно смотрю, а в конце присылаю отчёт файлом: что не так, чем вредит, как исправить.',
].join('\n')

/** Кнопки под приветствием: три вещи, которые спрашивают чаще всего. */
const MENU = {
  inline_keyboard: [
    [
      { text: 'Что проверяется', callback_data: 'help' },
      { text: 'Мои лимиты', callback_data: 'limits' },
    ],
    [{ text: 'Полный чек-лист на сайте', url: SITE }],
  ],
}

/** Команды, которые бот сам прописывает себе при запуске. */
const COMMANDS = [
  { command: 'start', description: 'Начать и увидеть подсказку' },
  { command: 'help', description: 'Что именно проверяется' },
  { command: 'limits', description: 'Сколько проверок осталось сегодня' },
]

const ABOUT = 'Технический аудит сайта: индексация, зеркала, разметка, ссылки, безопасность, скорость.'

const DESCRIPTION = [
  'Пришлите адрес сайта — получите отчёт: что не так, чем это вредит и как исправить.',
  '',
  'Проверяются индексация и robots.txt, зеркала и дубли, мета-теги и заголовки,',
  'внутренние ссылки, безопасность, аналитика, дубли контента и скорость загрузки.',
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

  const me = await call('getMe')

  // Оформление бота задаётся здесь, а не руками в BotFather: так подписи
  // лежат в репозитории вместе с кодом и не расходятся с тем, что бот умеет.
  await describeBot()

  console.log(`Бот @${me.username} запущен. Остановить: Ctrl+C`)
  console.log(
    HAS_MODEL
      ? 'Режим: агент. Порядок проверок выбирает модель.'
      : 'Режим: без модели. Проверки идут по заданному порядку, обращений к модели нет.\n' +
        'Добавьте ANTHROPIC_API_KEY в .env и перезапустите, чтобы включить агента.',
  )

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
      updates = await call('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      })
    } catch (error) {
      console.error('Не удалось получить обновления:', error.message || error)
      await sleep(3000)
      continue
    }

    for (const update of updates) {
      offset = update.update_id + 1
      if (update.message) handleMessage(update.message).catch(reportFailure)
      if (update.callback_query) handleButton(update.callback_query).catch(reportFailure)
    }
  }
}

/** Название, описание и список команд бота. */
async function describeBot() {
  const tasks = [
    ['setMyCommands', { commands: COMMANDS }],
    ['setMyShortDescription', { short_description: ABOUT }],
    ['setMyDescription', { description: DESCRIPTION }],
  ]

  for (const [method, payload] of tasks) {
    // Оформление не должно мешать работе: Telegram отклоняет повторную
    // установку того же текста, и это не повод не запускаться.
    await call(method, payload).catch((error) => {
      console.error(`${method}: ${error.message || error}`)
    })
  }
}

/** Нажатие на кнопку под сообщением. */
async function handleButton(query) {
  const chatId = query.message?.chat?.id
  const userId = String(query.from?.id || chatId)

  // Telegram ждёт подтверждения, иначе на кнопке останется крутиться часики
  await call('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {})

  if (!chatId) return
  if (query.data === 'help') await send(chatId, HELP)
  if (query.data === 'limits') await send(chatId, limitsFor(userId))
}

// ── разбор сообщений ─────────────────────────────────────────────────────────

async function handleMessage(message) {
  const chatId = message.chat.id
  const userId = String(message.from?.id || chatId)
  const text = (message.text || '').trim()

  if (!text) return

  if (text.startsWith('/start')) return void (await send(chatId, HELLO, MENU))
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

    const lines = [`Проверяю ${site}`, '', ...done.slice(-14).map(line)]
    await edit(chatId, progress.message_id, lines.join('\n')).catch(() => {})
  }

  // Время каждого шага: по нему видно, какая проверка тормозит,
  // и что работа идёт, а не зависла
  const onStep = (event) => {
    if (event.type === 'call') {
      done.push({ text: describeCall(event, site), startedAt: Date.now() })
      show()
    }

    if (event.type === 'result') {
      const step = done[done.length - 1]
      if (step && !step.ms) {
        step.ms = Date.now() - step.startedAt
        step.failed = event.ok === false
      }
      show()
    }
  }

  // Один и тот же вызов для обоих режимов: наружу они отдают одинаковый прогон
  const result = HAS_MODEL ? await audit(site, { onStep }) : await runDirect(site, { onStep })

  done.push({ text: `готово за ${seconds(Date.now() - started)}`, ms: 0, done: true })
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

/** Строка шага: что делаем и сколько это заняло. */
export function line(step) {
  if (step.done) return step.text
  if (step.failed) return `· ${step.text} — не отработал`
  if (!step.ms) return `· ${step.text} …`
  return `· ${step.text} — ${seconds(step.ms)}`
}

/** Длительность человеческими словами. */
export function seconds(ms) {
  if (ms < 1000) return '<1 с'
  if (ms < 60_000) return `${Math.round(ms / 1000)} с`

  const minutes = Math.floor(ms / 60_000)
  const rest = Math.round((ms % 60_000) / 1000)
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`
}

/**
 * Короткая строка о том, что сейчас делает агент.
 * Домен не повторяем на каждой строке: он уже назван в шапке сообщения,
 * а места в списке мало. Остаётся только путь, и то если он не корневой.
 */
export function describeCall(event, site = '') {
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
  const where = placeOf(event.input?.url, site)
  return where ? `${what} ${where}` : what
}

/** Путь страницы внутри проверяемого сайта; для чужого домена — имя домена. */
function placeOf(url, site) {
  if (!url) return ''

  try {
    const page = new URL(url)
    const host = site ? new URL(site).hostname : page.hostname
    if (page.hostname !== host) return page.hostname
    return page.pathname === '/' ? '' : cut(page.pathname, 28)
  } catch {
    return ''
  }
}

function cut(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
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

  if (result.model === 'без модели') {
    lines.push('Проверки шли по заданному порядку, без обращения к модели.')
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

function send(chatId, text, keyboard = null) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
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
