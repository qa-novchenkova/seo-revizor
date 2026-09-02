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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { toMarkdown, toHtml } from './report.js'
import { htmlToPdf, findBrowser } from './pdf.js'
import { saveRun, previousRun, compare } from './store.js'
import { SEVERITY_LABELS, SEVERITIES } from './rules/index.js'
import { money, plural, FORMS } from './lib/text.js'
import { checkSpeed } from './checks/speed.js'
import { checkSecurity } from './checks/security.js'
import { checkRobots } from './checks/robots.js'
import { checkMeta } from './checks/meta.js'

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
// Модель доступна двумя путями: напрямую у Anthropic или через шлюз Timeweb.
const HAS_MODEL = Boolean(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_KEY)

/**
 * Ограничения. Каждая проверка стоит денег и занимает несколько минут,
 * поэтому бот без них превращается в способ потратить чужой бюджет.
 */
const LIMITS = {
  perDay: Number(process.env.BOT_DAILY_LIMIT || 5),
  cooldownMs: Number(process.env.BOT_COOLDOWN_MINUTES || 2) * 60_000,
  queue: Number(process.env.BOT_QUEUE_LIMIT || 5),
  // Одиночные проверки дешевле полного аудита: модель не участвует,
  // запрос один. Поэтому у них свой, более щедрый лимит.
  quickPerDay: Number(process.env.BOT_QUICK_DAILY_LIMIT || 30),
  quickCooldownMs: Number(process.env.BOT_QUICK_COOLDOWN_SECONDS || 20) * 1000,
}

/**
 * Одиночные проверки: перепроверить одно место после правки,
 * не гоняя весь аудит заново.
 */
const QUICK = {
  speed: { title: 'Скорость', run: (site) => checkSpeed(site) },
  security: { title: 'Безопасность', run: (site) => checkSecurity(site) },
  robots: { title: 'robots.txt', run: (site) => checkRobots(site) },
  meta: { title: 'Мета-теги', run: (url) => checkMeta(url) },
}

/** Если список задан, проверки доступны только этим пользователям. */
const ALLOWED = (process.env.TELEGRAM_ALLOWED_USERS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

/**
 * Коды доступа. Если заданы, посторонний должен один раз прислать код.
 *
 * Это мягче белого списка: заранее знать чужой номер не нужно, достаточно
 * написать код в письме. И надёжнее, чем открывать бота вручную на время:
 * забыть закрыть его нельзя, потому что закрывать нечего.
 *
 * Кодов можно задать несколько через запятую и у каждого поставить дату,
 * после которой он перестаёт работать:
 *
 *   BOT_ACCESS_CODE=битрикс24, сеоджаз:2026-09-30, показ
 *
 * Смысл в том, чтобы давать свой код на каждый отклик: видно, кто пришёл,
 * и старые коды закрываются сами. Уже вошедших смена кода не выкидывает.
 */
const ACCESS_CODES = (process.env.BOT_ACCESS_CODE || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => {
    const at = item.lastIndexOf(':')
    const looksLikeDate = at > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.slice(at + 1).trim())

    return {
      code: (looksLikeDate ? item.slice(0, at) : item).trim().toLowerCase(),
      until: looksLikeDate ? item.slice(at + 1).trim() : null,
    }
  })

/** Общий потолок на всех: страховка кошелька от чужой активности. */
const GLOBAL_PER_DAY = Number(process.env.BOT_GLOBAL_DAILY_LIMIT || 0)

/** Куда записываются те, кто уже ввёл код: перезапуск не должен их выкидывать. */
const ACCESS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'access.json')

/** Кому показывать расход токенов. */
const ADMINS = (process.env.TELEGRAM_ADMINS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

const HELLO = [
  'Ревизор — технический аудит сайта.',
  '',
  'Пришлите адрес, например: example.com',
  '',
  'По ходу работы я показываю, что именно смотрю, а в конце присылаю отчёт файлом: что не так, чем вредит, как исправить.',
  '',
  'Проверяйте только свои сайты или те, где есть разрешение владельца. Проверка создаёт нагрузку и среди прочего запрашивает служебные файлы — на чужом сайте это выглядит как поиск уязвимостей.',
  '',
  'О вас бот хранит только числовой идентификатор Telegram, чтобы не спрашивать код повторно. Удалить его: /forget',
  '',
  `Полный чек-лист: ${SITE}`,
].join('\n')

/**
 * Постоянная клавиатура над полем ввода.
 *
 * Кнопки под сообщением уезжают вверх вместе с перепиской, а эти остаются
 * на месте всегда. Ссылку сюда положить нельзя — такие кнопки умеют только
 * отправлять свой текст, поэтому адрес сайта живёт в самих подсказках.
 */
const KEYS = {
  keyboard: [
    [{ text: 'Что проверяется' }, { text: 'Мои лимиты' }],
    [{ text: 'Быстрые проверки' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Адрес сайта, например example.com',
}

/** Тексты кнопок совпадают с командами: нажатие приходит обычным сообщением. */
const BUTTONS = {
  'Что проверяется': () => HELP,
  'Быстрые проверки': () => QUICK_HELP,
}

const QUICK_HELP = [
  'Быстрые проверки — перепроверить одно место, не гоняя весь аудит:',
  '',
  '/speed адрес — скорость и Core Web Vitals',
  '/security адрес — сертификат, заголовки, служебные файлы',
  '/robots адрес — robots.txt и карта сайта',
  '/meta адрес — мета-теги конкретной страницы',
  '',
  'Например: /speed example.com',
  '',
  'Отвечают за секунды и на полный аудит не расходуются.',
].join('\n')

/** Команды, которые бот сам прописывает себе при запуске. */
const COMMANDS = [
  { command: 'start', description: 'Начать и увидеть подсказку' },
  { command: 'help', description: 'Что именно проверяется' },
  { command: 'limits', description: 'Сколько проверок осталось сегодня' },
  { command: 'speed', description: 'Только скорость: /speed адрес' },
  { command: 'security', description: 'Только безопасность: /security адрес' },
  { command: 'robots', description: 'Только robots.txt: /robots адрес' },
  { command: 'meta', description: 'Только мета-теги страницы: /meta адрес' },
  { command: 'forget', description: 'Удалить мои данные из бота' },
]

const ABOUT = ACCESS_CODES.length
  ? 'Технический аудит сайта. Доступ по кодовому слову из письма.'
  : 'Технический аудит сайта: индексация, зеркала, разметка, ссылки, безопасность, скорость.'

const CHECKS_LINE =
  'Проверяются индексация и robots.txt, зеркала и дубли, мета-теги и заголовки, внутренние ссылки, безопасность, аналитика, дубли контента и скорость загрузки.'

/**
 * Описание, которое Telegram показывает на пустом экране, до нажатия «Запустить».
 * Когда доступ закрыт кодом, сказать про код надо именно здесь: иначе человек
 * присылает адрес, получает отказ и уходит, так и не поняв, чего от него хотят.
 */
const DESCRIPTION = (
  ACCESS_CODES.length
    ? [
        'Доступ по кодовому слову — оно указано в письме рядом со ссылкой на бота.',
        '',
        'Нажмите «Запустить» и пришлите код. Дальше пришлите адрес сайта и получите отчёт: что не так, чем это вредит и как исправить.',
        '',
        CHECKS_LINE,
      ]
    : [
        'Пришлите адрес сайта — получите отчёт: что не так, чем это вредит и как исправить.',
        '',
        CHECKS_LINE,
      ]
).join('\n')

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
  '',
  'Пришлите адрес — проверю всё сразу. Если нужно перепроверить одно место после правки, есть быстрые команды:',
  '',
  '/speed адрес — скорость и Core Web Vitals',
  '/security адрес — сертификат, заголовки, служебные файлы',
  '/robots адрес — robots.txt и карта сайта',
  '/meta адрес — мета-теги конкретной страницы',
  '',
  'Полный чек-лист: https://qa-novchenkova.github.io/seo-revizor/',
].join('\n')

// ── состояние ────────────────────────────────────────────────────────────────

/** Что пользователь уже потратил: счётчик на сутки и время прошлого запуска. */
const usage = new Map()

/** Очередь заданий. Проверки идут по одной: параллельные упрутся в лимиты сайта. */
const queue = []
let working = false

/** Сколько проверок сделано за сутки всеми вместе. */
let globalDay = ''
let globalCount = 0

/** Кто уже ввёл код доступа. Хранится на диске: перезапуск не должен их выкидывать. */
const unlocked = loadUnlocked()

function loadUnlocked() {
  try {
    return new Set(JSON.parse(readFileSync(ACCESS_FILE, 'utf8')))
  } catch {
    return new Set()
  }
}

function saveUnlocked() {
  try {
    mkdirSync(path.dirname(ACCESS_FILE), { recursive: true })
    writeFileSync(ACCESS_FILE, JSON.stringify([...unlocked]), 'utf8')
  } catch (error) {
    // Не записалось — доступ продолжит работать до перезапуска
    console.error('Не удалось сохранить список доступа:', error.message || error)
  }
}

/**
 * Ищет код среди действующих.
 * Возвращает сам код, чтобы было видно, по какому отклику пришёл человек.
 */
export function matchCode(text) {
  const given = String(text || '').trim().toLowerCase()
  if (!given) return null

  return (
    ACCESS_CODES.find((entry) => entry.code === given && (!entry.until || entry.until >= today())) || null
  )
}

/** Пускать ли этого человека к проверкам. */
/**
 * Удаление следов человека по его просьбе.
 *
 * Бот хранит о людях единственное: числовой идентификатор тех, кто ввёл код.
 * Право попросить это удалить есть у каждого, и просьба должна исполняться
 * без переписки с владельцем — поэтому обычная команда, а не обращение.
 */
export function forget(userId) {
  const wasIn = unlocked.delete(userId)
  if (wasIn) saveUnlocked()

  forgetLimits(userId)

  return wasIn
    ? 'Ваш идентификатор удалён, счётчики сброшены. Чтобы вернуться, пришлите кодовое слово заново.'
    : 'Удалять нечего: ваш идентификатор у бота не сохранён.'
}

export function accessState(userId, text = '') {
  if (ALLOWED.length && !ALLOWED.includes(userId)) return 'closed'
  // Владелец бота код не вводит: иначе смена кодов запирает его самого.
  if (ADMINS.includes(userId)) return 'open'
  if (!ACCESS_CODES.length) return 'open'
  if (unlocked.has(userId)) return 'open'
  return matchCode(text) ? 'code' : 'locked'
}

/** Общий счётчик на всех: обнуляется вместе с сутками. */
export function checkGlobalLimit() {
  if (!GLOBAL_PER_DAY) return null

  if (globalDay !== today()) {
    globalDay = today()
    globalCount = 0
  }

  return globalCount >= GLOBAL_PER_DAY
    ? 'На сегодня общий лимит проверок исчерпан. Попробуйте завтра.'
    : null
}

export function spendGlobal() {
  if (globalDay !== today()) {
    globalDay = today()
    globalCount = 0
  }
  globalCount += 1
}

/** Как назвать человека в уведомлении: имя, ник и номер. */
export function describeUser(from = {}) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ')
  const nick = from.username ? `@${from.username}` : ''
  return [name, nick, `id ${from.id}`].filter(Boolean).join(', ')
}

/** Сообщение владельцу бота: кто-то воспользовался кодом. */
async function tellAdmins(text) {
  for (const admin of ADMINS) {
    await send(admin, text).catch(() => {})
  }
}

/** Сброс для тестов. */
export function resetAccess() {
  unlocked.clear()
  globalDay = ''
  globalCount = 0
}

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

  // ── доступ ───────────────────────────────────────────────────────────────
  const access = accessState(userId, text)

  if (access === 'code') {
    const entry = matchCode(text)
    unlocked.add(userId)
    saveUnlocked()

    await send(chatId, `Код принят, доступ открыт.\n\n${HELLO}`, KEYS)
    await tellAdmins(`Кодом «${entry.code}» открыл доступ ${describeUser(message.from)}`)
    return
  }

  if (access === 'closed') {
    return void (await send(chatId, 'Бот работает в закрытом режиме.'))
  }

  if (access === 'locked') {
    const first = text.startsWith('/start')
    return void (await send(
      chatId,
      [
        'Ревизор — технический аудит сайта.',
        '',
        first
          ? 'Чтобы начать, пришлите кодовое слово — оно указано в письме рядом со ссылкой на бота.'
          : 'Сначала кодовое слово: оно указано в письме рядом со ссылкой на бота. Адрес сайта пришлёте следующим сообщением.',
        '',
        `Что умеет бот, можно посмотреть и без кода: ${SITE}`,
      ].join('\n'),
    ))
  }

  if (text.startsWith('/start')) return void (await send(chatId, HELLO, KEYS))
  if (text.startsWith('/help')) return void (await send(chatId, HELP))
  if (text.startsWith('/limits') || text === 'Мои лимиты') {
    return void (await send(chatId, limitsFor(userId)))
  }

  if (text.startsWith('/forget')) return void (await send(chatId, forget(userId)))

  // Нажатие на постоянную кнопку приходит обычным сообщением с её текстом
  if (BUTTONS[text]) return void (await send(chatId, BUTTONS[text]()))

  // Быстрая проверка: /speed адрес
  const quick = text.match(/^\/(\w+)/)
  if (quick && QUICK[quick[1]]) return void (await runQuick(chatId, userId, quick[1], text))

  const site = parseSite(text)
  if (!site) {
    return void (await send(chatId, 'Нужен адрес сайта целиком, например https://example.com'))
  }

  const overall = checkGlobalLimit()
  if (overall) return void (await send(chatId, overall))

  const denial = checkLimits(userId)
  if (denial) return void (await send(chatId, denial))

  if (queue.length >= LIMITS.queue) {
    return void (await send(chatId, 'Очередь заполнена, попробуйте через несколько минут.'))
  }

  spend(userId)
  spendGlobal()
  queue.push({ chatId, userId, site })

  const ahead = queue.length - 1
  const notice = await send(
    chatId,
    ahead ? `Принято: ${site}\nВ очереди перед вами: ${ahead}` : `Принято: ${site}\nНачинаю проверку.`,
  )

  runQueue(notice)
}

// ── одиночные проверки ───────────────────────────────────────────────────────

async function runQuick(chatId, userId, name, text) {
  const { title, run } = QUICK[name]
  const site = parseSite(text.replace(/^\/\w+(@\S+)?/, ''))

  if (!site) {
    return void (await send(chatId, `Нужен адрес: /${name} example.com`))
  }

  const denial = checkQuickLimits(userId)
  if (denial) return void (await send(chatId, denial))

  spendQuick(userId)

  const notice = await send(chatId, `${title}: проверяю ${site}…`)
  const started = Date.now()

  try {
    const result = await run(site)
    const body = renderQuick(title, site, result, Date.now() - started)
    await edit(chatId, notice.message_id, body)
  } catch (error) {
    await edit(chatId, notice.message_id, `${title}: не получилось — ${error.message || error}`)
  }
}

/** Результат одиночной проверки текстом: файл ради нескольких строк не нужен. */
export function renderQuick(title, site, result, ms) {
  const head = `${title} · ${site}`

  if (result.ok === false) {
    return [head, '', result.error || 'проверка не отработала', result.hint || ''].join('\n').trim()
  }

  const lines = [head, '']

  // У скорости главное — цифры, а не только замечания
  if (result.metrics) {
    const names = { lcp: 'LCP', cls: 'CLS', inp: 'INP', ttfb: 'ответ сервера', total: 'вес страницы' }
    const shown = Object.entries(result.metrics).filter(([, value]) => value)
    if (result.score !== undefined) lines.push(`Оценка: ${result.score} из 100`)
    for (const [key, value] of shown) lines.push(`${names[key] || key}: ${value}`)
    lines.push('')
  }

  const findings = result.findings || []

  if (!findings.length) {
    lines.push('Замечаний нет.')
  } else {
    lines.push(`Найдено ${findings.length}:`, '')
    for (const finding of findings) {
      lines.push(`[${SEVERITY_LABELS[finding.severity]}] ${finding.title}`)
      lines.push(finding.message)
      lines.push(`→ ${finding.fix}`)
      lines.push('')
    }
  }

  lines.push(`Проверено за ${seconds(ms)}.`)

  // В сообщение Telegram помещается около 4000 знаков
  const text = lines.join('\n').trim()
  return text.length > 3900 ? text.slice(0, 3880) + '\n\n…список обрезан, запустите полный аудит' : text
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

  const fresh = { day: today(), count: 0, lastAt: 0, quickCount: 0, quickAt: 0 }
  usage.set(userId, fresh)
  return fresh
}

export function checkQuickLimits(userId) {
  const state = stateOf(userId)

  if (state.quickCount >= LIMITS.quickPerDay) {
    return `Быстрых проверок на сегодня больше нет: ${LIMITS.quickPerDay} в сутки.`
  }

  const wait = state.quickAt + LIMITS.quickCooldownMs - Date.now()
  if (wait > 0) return `Следующую быструю проверку можно через ${Math.ceil(wait / 1000)} с.`

  return null
}

export function spendQuick(userId) {
  const state = stateOf(userId)
  state.quickCount += 1
  state.quickAt = Date.now()
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

/** Счётчики одного человека: часть удаления данных по его просьбе. */
function forgetLimits(userId) {
  usage.delete(userId)
}

function limitsFor(userId) {
  const state = stateOf(userId)
  const left = Math.max(0, LIMITS.perDay - state.count)
  const quickLeft = Math.max(0, LIMITS.quickPerDay - state.quickCount)

  return [
    `Полных проверок осталось сегодня: ${left} из ${LIMITS.perDay}.`,
    `Пауза между запусками: ${Math.round(LIMITS.cooldownMs / 60_000)} мин.`,
    '',
    `Быстрых проверок осталось: ${quickLeft} из ${LIMITS.quickPerDay}.`,
    `Пауза между ними: ${Math.round(LIMITS.quickCooldownMs / 1000)} с.`,
  ].join('\n')
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

  const show = async (force = false, tail = '') => {
    // Telegram не любит частых правок сообщения, поэтому не чаще раза в две секунды
    if (!force && Date.now() - lastEdit < 2000) return
    lastEdit = Date.now()

    const lines = [`Проверяю ${site}`, '', ...done.slice(-14).map(line)]
    if (tail) lines.push('', tail)
    await edit(chatId, progress.message_id, lines.join('\n')).catch(() => {})
  }

  // Время каждого шага: по нему видно, какая проверка тормозит,
  // и что работа идёт, а не зависла
  let running = null

  const onStep = (event) => {
    if (event.type === 'call') {
      running = stepFor(done, describeCall(event, site))
      running.startedAt = Date.now()
      show()
    }

    if (event.type === 'result') {
      if (running) {
        running.ms += Date.now() - running.startedAt
        running.failed = running.failed || event.ok === false
        running.startedAt = null
        running = null
      }
      show()
    }
  }

  // Один и тот же вызов для обоих режимов: наружу они отдают одинаковый прогон
  const result = HAS_MODEL ? await audit(site, { onStep }) : await runDirect(site, { onStep })

  done.push({ text: `готово за ${seconds(Date.now() - started)}`, ms: 0, done: true })
  await show(true, pagesLine(result.pages, site))

  // ── отчёт ────────────────────────────────────────────────────────────────
  const previous = previousRun(site)
  const diff = previous ? compare(result, previous) : null
  const markdown = toMarkdown(result, diff)
  const saved = saveRun(result, { md: markdown, html: toHtml(result, diff) })

  const caption = summary(result, diff)
  const name = fileNameFor(site)
  const pdf = await makePdf(saved)

  // Три вида отчёта: PDF показать и распечатать, HTML открыть в браузере,
  // Markdown — положить в свои заметки и править. Подпись идёт с первым:
  // Telegram показывает её под файлом, и повторять её трижды незачем.
  const files = [
    pdf && { data: pdf, name: name + '.pdf', mime: 'application/pdf' },
    saved.files.html && {
      data: readFileSync(saved.files.html),
      name: name + '.html',
      mime: 'text/html',
    },
    { data: markdown, name: name + '.md', mime: 'text/markdown' },
  ].filter(Boolean)

  for (const [index, file] of files.entries()) {
    await sendDocument(chatId, file.data, file.name, index === 0 ? caption : '', file.mime)
  }

  if (ADMINS.includes(userId) && result.usage.cost !== null) {
    await send(
      chatId,
      `Расход: ${result.usage.inputTokens} + ${result.usage.outputTokens} токенов, ` +
        `примерно ${money(result.usage.cost, result.usage.currency)}. ` +
        `Вызовов инструментов: ${result.calls.length}.`,
    )
  }

  console.log(`${site}: находок ${result.findings.length}, вызовов ${result.calls.length}`)
}

/** Строка шага: что делаем и сколько это заняло. */
export function line(step) {
  if (step.done) return step.text
  if (step.failed) return `· ${step.text} — не отработал`
  // startedAt стоит, пока вызов идёт. У повторного вызова время с прошлого
  // раза уже есть, но показывать его рано: проверка ещё не закончилась.
  if (step.startedAt || !step.ms) return `· ${step.text} …`
  return `· ${step.text} — ${seconds(step.ms)}`
}

/**
 * Строка хода для очередного вызова.
 *
 * Один и тот же инструмент вызывается по нескольку раз — для разных страниц.
 * Три одинаковых строки подряд выглядят как сбой, поэтому строка остаётся
 * одна, а время складывается.
 */
export function stepFor(done, text) {
  const found = done.find((item) => item.text === text && !item.done)
  if (found) return found

  const entry = { text, ms: 0 }
  done.push(entry)
  return entry
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

  // Адрес в строке не показываем намеренно: часть инструментов берёт список
  // страниц одним вызовом, и строка про одну страницу вводила в заблуждение.
  // Полный список идёт в конце проверки и в самом отчёте.
  return names[event.name] || event.name
}

/** Список проверенных страниц под ходом проверки. */
export function pagesLine(pages = [], site = '') {
  if (!pages.length) return ''

  // Адреса здесь не режем: это единственное место, где видно, что именно
  // проверено, и обрубок вида /sitemaps/channels_v2/sitem… ничего не говорит.
  const shown = pages.slice(0, 12).map((page) => placeOf(page, site, Infinity) || '/')
  const rest = pages.length - shown.length

  return (
    `проверено на ${pages.length} ${plural(pages.length, FORMS.pageOn)}: ` +
    shown.join(', ') +
    (rest > 0 ? ` и ещё ${rest}` : '')
  )
}

/** Путь страницы внутри проверяемого сайта; для чужого домена — имя домена. */
function placeOf(url, site, max = 28) {
  if (!url) return ''

  try {
    const page = new URL(url)
    const host = site ? new URL(site).hostname : page.hostname
    if (page.hostname !== host) return page.hostname
    return page.pathname === '/' ? '' : cut(page.pathname, max)
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
    lines.push(`С прошлой проверки: исправлено ${diff.fixed.length}, новых ${diff.appeared.length}`)
  }

  if (result.stoppedBy === 'limit') {
    lines.push('Проверка остановлена по лимиту шагов: разобраны не все разделы.')
  }

  if (result.model === 'без модели') {
    lines.push('Проверки шли по заданному порядку, без обращения к модели.')
  }

  return lines.join('\n')
}

/**
 * Печатает отчёт в PDF, если на машине есть браузер.
 *
 * Своего браузера проект не носит: печать делает уже установленный Chrome
 * ключом --print-to-pdf. На сервере его может не быть, поэтому отсутствие
 * браузера не ошибка — просто уйдёт Markdown.
 */
async function makePdf(saved) {
  if (!findBrowser() || !saved.files.html) return null

  const target = `${saved.base}.pdf`
  const result = await htmlToPdf(saved.files.html, target)

  if (!result.ok) {
    console.error('PDF не собрался:', result.reason)
    return null
  }

  return readFileSync(target)
}

function fileNameFor(site) {
  const host = safeHost(site)
  return `revizor-${host}-${new Date().toISOString().slice(0, 10)}`
}

function safeHost(site) {
  try {
    return new URL(site).hostname.replace(/[^a-z0-9.-]/gi, '-')
  } catch {
    return 'site'
  }
}


// ── общение с Telegram ───────────────────────────────────────────────────────

/**
 * Стоит ли повторять обращение к Telegram.
 *
 * Сеть до Telegram бывает капризной: подключение изредка виснет и обрывается
 * по времени. Без повтора ответ на нажатие кнопки просто пропадает, и человек
 * решает, что бот сломался. А вот отказ самого Telegram повторять бессмысленно:
 * на тот же запрос придёт тот же отказ.
 */
export function shouldRetry(error, attempt, attempts = CALL_ATTEMPTS) {
  if (error?.fromTelegram) return false
  return attempt < attempts
}

const CALL_ATTEMPTS = 3

async function call(method, payload = {}, attempts = CALL_ATTEMPTS) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        // Длинное ожидание висит до 30 секунд, поэтому запас сверху
        signal: AbortSignal.timeout(60_000),
      })

      const data = await response.json()
      if (!data.ok) {
        const error = new Error(`${method}: ${data.description || response.status}`)
        error.fromTelegram = true
        throw error
      }
      return data.result
    } catch (error) {
      if (!shouldRetry(error, attempt, attempts)) throw error
      await sleep(400 * attempt)
    }
  }
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
async function sendDocument(chatId, content, fileName, caption, mime = 'text/markdown') {
  // Повтор нужен по той же причине, что и в обычных сообщениях: сеть до
  // Telegram изредка виснет. Отчётов теперь три, и потеря одного из них
  // выглядела бы как пропавший файл без всякого объяснения.
  for (let attempt = 1; ; attempt++) {
    try {
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('caption', (caption || '').slice(0, 1000))
      form.append('document', new Blob([content], { type: mime }), fileName)

      const response = await fetch(`${API}/sendDocument`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      })

      const data = await response.json()
      if (!data.ok) {
        const error = new Error(`sendDocument: ${data.description || response.status}`)
        error.fromTelegram = true
        throw error
      }
      return data.result
    } catch (error) {
      if (!shouldRetry(error, attempt)) throw error
      await sleep(400 * attempt)
    }
  }
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
