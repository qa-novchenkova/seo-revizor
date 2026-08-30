/**
 * Проверка логики бота — без токена, без сети и без обращений к модели.
 *
 * Проверяем то, что решает судьбу сообщения ещё до запуска агента:
 * разбор адреса, ограничения и формулировки, которые увидит человек.
 *
 *   node test/bot.js
 */
import assert from 'node:assert/strict'

import { parseSite, checkLimits, spend, resetLimits, describeCall, summary } from '../src/bot.js'

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

assert.equal(
  describeCall({ name: 'check_robots', input: { url: 'https://example.com/' } }),
  'robots.txt — example.com',
)
assert.equal(describeCall({ name: 'check_content', input: {} }), 'контент и дубли')
assert.equal(describeCall({ name: 'неизвестный', input: {} }), 'неизвестный', 'новый инструмент не ломает вывод')
console.log('  ✓ шаги подписаны по-русски, неизвестный инструмент не ломает вывод')

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

const text = summary(run, { fixed: ['x'], added: ['y', 'z'], stayed: [] })
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

console.log('\n  Логика бота работает.\n')
