/**
 * Проверка логики бота — без токена, без сети и без обращений к модели.
 *
 * Проверяем то, что решает судьбу сообщения ещё до запуска агента:
 * разбор адреса, ограничения и формулировки, которые увидит человек.
 *
 *   node test/bot.js
 */
import assert from 'node:assert/strict'

// Тест не должен зависеть от личного .env: там могут стоять коды доступа
// и потолки, и тогда поведение по умолчанию не проверить.
process.env.REVIZOR_SKIP_ENV = '1'

// Импорт динамический намеренно: обычный import выполняется раньше строк
// выше него, и выключатель .env не успел бы подействовать.
const {
  parseSite,
  checkLimits,
  spend,
  resetLimits,
  describeCall,
  summary,
  line,
  seconds,
  renderQuick,
  checkQuickLimits,
  spendQuick,
  accessState,
  forget,
  pagesLine,
  stepFor,
  checkGlobalLimit,
  resetAccess,
  shouldRetry,
} = await import('../src/bot.js')

console.log('\n  Проверка бота\n')

// ── разбор адреса ────────────────────────────────────────────────────────────

assert.equal(parseSite('https://example.com'), 'https://example.com/')
assert.equal(parseSite('example.com'), 'https://example.com/', 'адрес без схемы тоже принимается')
assert.equal(parseSite('  https://example.com/catalog  '), 'https://example.com/catalog')
assert.equal(
  parseSite('проверь пожалуйста https://example.com/shop вот этот'),
  'https://example.com/shop',
  'адрес должен находиться внутри фразы',
)
assert.equal(parseSite('http://example.com'), 'http://example.com/', 'схема не подменяется')
console.log('  ✓ адрес вынимается из сообщения, путь сохраняется')

assert.equal(parseSite('привет'), null)
assert.equal(parseSite(''), null)
assert.equal(parseSite('localhost'), null, 'имя без точки не адрес')
assert.equal(parseSite('/help'), null, 'команда не должна приниматься за адрес')
console.log('  ✓ мусор и команды не принимаются за адрес')

// ── ограничения ──────────────────────────────────────────────────────────────

resetLimits()

assert.equal(checkLimits('user-1'), null, 'первая проверка разрешена')

spend('user-1')
const cooldown = checkLimits('user-1')
assert.ok(cooldown, 'сразу после запуска должна включаться пауза')
assert.match(cooldown, /через \d+ мин/, 'в тексте должно быть, сколько ждать')
console.log('  ✓ пауза между запусками работает и объясняется человеку')

resetLimits()
for (let i = 0; i < 5; i++) spend('user-2')
const exhausted = checkLimits('user-2')
assert.ok(exhausted, 'после дневного лимита проверки закрываются')
assert.match(exhausted, /в сутки/, 'человеку сказано, что кончился дневной лимит')
console.log('  ✓ дневной лимит закрывает проверки и объясняет причину')

resetLimits()
spend('user-3')
assert.equal(checkLimits('user-4'), null, 'лимиты считаются по каждому отдельно')
console.log('  ✓ лимиты не общие, а по пользователям')

// ── что видит человек по ходу проверки ───────────────────────────────────────

const site = 'https://example.com/'

assert.equal(describeCall({ name: 'check_robots', input: { url: site } }, site), 'robots.txt')
assert.equal(
  describeCall({ name: 'check_meta', input: { url: 'https://example.com/legal/offer' } }, site),
  'мета-теги',
  'адрес в ходе проверки не показываем: список идёт в конце',
)
assert.equal(describeCall({ name: 'check_content', input: {} }, site), 'контент и дубли')
assert.equal(describeCall({ name: 'неизвестный', input: {} }, site), 'неизвестный', 'новый инструмент не ломает вывод')
console.log('  ✓ шаги подписаны по-русски')

// ── время шагов ──────────────────────────────────────────────────────────────

assert.equal(seconds(400), '<1 с')
assert.equal(seconds(2400), '2 с')
assert.equal(seconds(65_000), '1 мин 5 с')
assert.equal(seconds(120_000), '2 мин')
console.log('  ✓ длительность пишется словами, без долей секунды')

assert.equal(line({ text: 'скорость' }), '· скорость …', 'пока шаг идёт, у него многоточие')
assert.equal(line({ text: 'скорость', ms: 41_000 }), '· скорость — 41 с')
assert.equal(line({ text: 'скорость', ms: 900, failed: true }), '· скорость — не отработал')
assert.equal(line({ text: 'готово за 2 мин', done: true }), 'готово за 2 мин', 'итоговая строка без точки списка')
console.log('  ✓ строка шага показывает ход, длительность и сбой')

// Один инструмент вызывается по нескольку раз — для разных страниц.
// Строка при этом остаётся одна, а время складывается.
const steps = []
const first = stepFor(steps, 'мета-теги')
first.ms = 400
const second = stepFor(steps, 'мета-теги')
second.ms += 600
stepFor(steps, 'скорость').ms = 12_000

assert.equal(steps.length, 2, 'повторный вызов не заводит вторую строку')
assert.equal(second, first, 'это одна и та же строка')
assert.equal(first.ms, 1000, 'время складывается')
assert.equal(line({ text: 'мета-теги', ms: 1000 }), '· мета-теги — 1 с')
assert.equal(
  line({ text: 'мета-теги', ms: 1000, startedAt: Date.now() }),
  '· мета-теги …',
  'пока идёт повторный вызов, старое время не показываем',
)
console.log('  ✓ повторные вызовы одного инструмента идут одной строкой')

// ── итог ─────────────────────────────────────────────────────────────────────

const run = {
  site: 'https://example.com/',
  findings: [
    { id: 'a', severity: 'critical' },
    { id: 'b', severity: 'critical' },
    { id: 'c', severity: 'minor' },
  ],
  stoppedBy: 'end_turn',
}

// Поля здесь те же, что возвращает compare() из store.js. Раньше в тесте
// стояло added вместо appeared — тест проходил, а бот падал на живом прогоне.
const text = summary(run, { fixed: ['x'], appeared: ['y', 'z'], stayed: [] })
assert.match(text, /Найдено 3/)
assert.match(text, /критично: 2/)
assert.match(text, /исправлено 1, новых 2/)
console.log('  ✓ итог считает находки по важности и показывает динамику')

const clean = summary({ site: 'https://example.com/', findings: [], stoppedBy: 'end_turn' }, null)
assert.match(clean, /Замечаний нет/)
assert.doesNotMatch(clean, /С прошлой проверки/, 'без прошлого прогона строки сравнения быть не должно')
console.log('  ✓ чистый сайт и первый прогон описываются корректно')

const cut = summary({ site: 'https://example.com/', findings: [], stoppedBy: 'limit' }, null)
assert.match(cut, /остановлена по лимиту/, 'обрыв по лимиту шагов нельзя скрывать от человека')
console.log('  ✓ незавершённая проверка честно помечается')

const noModel = summary(
  { site: 'https://example.com/', findings: [], stoppedBy: 'end_turn', model: 'без модели' },
  null,
)
assert.match(noModel, /без обращения к модели/, 'режим без модели нельзя выдавать за работу агента')
console.log('  ✓ прогон без модели помечен как таковой')

// ── одиночные проверки ───────────────────────────────────────────────────────

resetLimits()
assert.equal(checkQuickLimits('quick-1'), null, 'первая быстрая проверка разрешена')
spendQuick('quick-1')
assert.match(checkQuickLimits('quick-1'), /через \d+ с/, 'между быстрыми проверками своя короткая пауза')
assert.equal(checkLimits('quick-1'), null, 'быстрая проверка не съедает лимит полного аудита')
console.log('  ✓ у быстрых проверок отдельный лимит и своя пауза')

const speed = renderQuick(
  'Скорость',
  'https://example.com/',
  {
    ok: true,
    score: 62,
    metrics: { lcp: '4.1 с', cls: '0.02', inp: null, ttfb: '210 мс', total: '1.4 МБ' },
    findings: [
      {
        severity: 'critical',
        title: 'Долго появляется главное содержимое',
        message: 'LCP на мобильных: 4.1 с при норме до 2,5 с.',
        fix: 'Сожмите картинку первого экрана.',
      },
    ],
  },
  41_000,
)

assert.match(speed, /Оценка: 62 из 100/, 'по скорости важны цифры, а не только замечания')
assert.match(speed, /LCP: 4\.1 с/)
assert.doesNotMatch(speed, /INP/, 'непосчитанные показатели не выводим')
assert.match(speed, /→ Сожмите/, 'у каждого замечания есть, что делать')
assert.match(speed, /Проверено за 41 с/)
console.log('  ✓ быстрая проверка скорости показывает показатели и что исправить')

const clean2 = renderQuick('robots.txt', 'https://example.com/', { ok: true, findings: [] }, 800)
assert.match(clean2, /Замечаний нет/)

const failed = renderQuick('Скорость', 'https://example.com/', { ok: false, error: 'нет ключа', hint: 'получите ключ' }, 100)
assert.match(failed, /нет ключа/)
assert.match(failed, /получите ключ/, 'подсказку из проверки нельзя терять')
console.log('  ✓ пустой результат и сбой описываются понятно')

const many = renderQuick(
  'Мета-теги',
  'https://example.com/',
  {
    ok: true,
    findings: Array.from({ length: 60 }, (_, i) => ({
      severity: 'minor',
      title: 'Замечание ' + i,
      message: 'Очень длинное описание замечания, чтобы проверить обрезку. '.repeat(3),
      fix: 'Что-нибудь сделать.',
    })),
  },
  500,
)
assert.ok(many.length <= 3950, `сообщение должно влезать в лимит Telegram, сейчас ${many.length}`)
assert.match(many, /список обрезан/, 'обрезку нельзя делать молча')
console.log('  ✓ длинный список обрезается и об этом сказано')

// В ходе проверки адреса не показываются: часть инструментов берёт список
// страниц одним вызовом, и строка про одну страницу вводила в заблуждение.
assert.equal(describeCall({ name: 'check_content', input: { urls: ['a', 'b'] } }), 'контент и дубли')
assert.equal(
  describeCall({ name: 'check_meta', input: { url: 'https://example.com/catalog' } }, 'https://example.com/'),
  'мета-теги',
)
console.log('  ✓ в ходе проверки видно название проверки, без адресов')

// Зато в конце идёт полный список: сколько страниц и какие именно.
assert.equal(
  pagesLine(['https://example.com/', 'https://example.com/catalog', 'https://example.com/about'], 'https://example.com/'),
  'проверено на 3 страницах: /, /catalog, /about',
)
assert.equal(
  pagesLine(Array.from({ length: 15 }, (_, i) => `https://example.com/p${i}`), 'https://example.com/'),
  'проверено на 15 страницах: ' +
    Array.from({ length: 12 }, (_, i) => `/p${i}`).join(', ') +
    ' и ещё 3',
  'длинный список обрезается, но общее число остаётся честным',
)
assert.equal(pagesLine([], 'https://example.com/'), '', 'без страниц строки нет')

// Длинные адреса в этом списке не обрезаются: обрубок ничего не сообщает.
assert.equal(
  pagesLine(['https://example.com/sitemaps/catalog_v2/sitemap.xml'], 'https://example.com/'),
  'проверено на 1 странице: /sitemaps/catalog_v2/sitemap.xml',
)
console.log('  ✓ в конце перечислены проверенные страницы')

// ── повтор обращений к Telegram ──────────────────────────────────────────────

const network = Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
const refusal = Object.assign(new Error('sendMessage: chat not found'), { fromTelegram: true })

assert.equal(shouldRetry(network, 1, 3), true, 'обрыв сети — пробуем ещё раз')
assert.equal(shouldRetry(network, 3, 3), false, 'после трёх попыток сдаёмся')
assert.equal(shouldRetry(refusal, 1, 3), false, 'отказ самого Telegram повторять бессмысленно')
console.log('  ✓ сетевой сбой повторяется, отказ Telegram — нет')

// ── доступ по коду ───────────────────────────────────────────────────────────

// Код задаётся переменной окружения, поэтому проверяем то поведение,
// которое видно без него: бот открыт всем, общего потолка нет.
resetAccess()
assert.equal(accessState('гость', 'привет'), 'open', 'без кода бот открыт всем')
assert.equal(checkGlobalLimit(), null, 'без общего лимита ничего не запрещается')
console.log('  ✓ по умолчанию бот открыт и общего потолка нет')

console.log('\n  Логика бота работает.\n')

// ── удаление своих данных ────────────────────────────────────────────────────

// Право попросить удалить свои данные есть у каждого, и просьба исполняется
// командой, а не перепиской с владельцем бота.

resetAccess()
resetLimits()

const nothing = forget('никогда-не-заходил')
assert.match(nothing, /нечего/, 'если данных нет, так и говорим')
assert.doesNotMatch(nothing, /удал[её]н/, 'не сообщаем об удалении того, чего не было')

spend('гость-удаляющий')
assert.ok(checkLimits('гость-удаляющий'), 'после проверки включается пауза')
forget('гость-удаляющий')
assert.equal(checkLimits('гость-удаляющий'), null, 'вместе с данными стираются и счётчики')
console.log('  ✓ человек может стереть свои данные командой')
