/**
 * Проверка доступа по коду и общего потолка.
 *
 * Коды и лимит берутся из переменных окружения при загрузке файла, поэтому
 * здесь они задаются до импорта бота, а не в самом тесте.
 *
 *   node test/access.js
 */
import assert from 'node:assert/strict'

const today = new Date().toISOString().slice(0, 10)
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

process.env.BOT_ACCESS_CODE = `битрикс24, сеоджаз:${today}, прошлый:${yesterday}`
process.env.BOT_GLOBAL_DAILY_LIMIT = '3'

const { accessState, matchCode, checkGlobalLimit, spendGlobal, resetAccess, describeUser } =
  await import('../src/bot.js')

console.log('\n  Проверка доступа по коду\n')

resetAccess()

// ── несколько кодов ──────────────────────────────────────────────────────────

assert.equal(matchCode('битрикс24')?.code, 'битрикс24', 'код без даты работает всегда')
assert.equal(matchCode('сеоджаз')?.code, 'сеоджаз', 'код действует в последний свой день')
assert.equal(matchCode('прошлый'), null, 'вчерашний код уже не пускает')
assert.equal(matchCode('чужое слово'), null)
console.log('  ✓ кодов может быть несколько, просроченный не работает')

assert.equal(matchCode(' Битрикс24 ')?.code, 'битрикс24', 'регистр и пробелы не мешают')
assert.equal(matchCode(''), null, 'пустая строка кодом не является')
console.log('  ✓ код принимается независимо от регистра и пробелов')

// ── состояние доступа ────────────────────────────────────────────────────────

assert.equal(accessState('чужой', 'привет'), 'locked', 'без кода посторонний не проходит')
assert.equal(accessState('чужой', 'https://example.com'), 'locked', 'адрес кодом не является')
assert.equal(accessState('гость', 'битрикс24'), 'code', 'верный код открывает доступ')
console.log('  ✓ без кода бот не пускает, с кодом открывается')

// ── кто пришёл ───────────────────────────────────────────────────────────────

assert.equal(
  describeUser({ first_name: 'Иван', last_name: 'Петров', username: 'ivan', id: 42 }),
  'Иван Петров, @ivan, id 42',
)
assert.equal(describeUser({ first_name: 'Аноним', id: 7 }), 'Аноним, id 7', 'без ника тоже понятно')
console.log('  ✓ в уведомлении видно, кто именно открыл доступ')

// ── общий потолок ────────────────────────────────────────────────────────────

resetAccess()

assert.equal(checkGlobalLimit(), null, 'пока лимит не выбран, проверки идут')
spendGlobal()
spendGlobal()
assert.equal(checkGlobalLimit(), null, 'две из трёх — ещё можно')

spendGlobal()
const stop = checkGlobalLimit()
assert.ok(stop, 'после третьей общий лимит закрывает проверки')
assert.match(stop, /общий лимит/, 'человеку сказано, что упёрлись в общий потолок, а не в личный')
console.log('  ✓ общий потолок считается на всех и объясняет причину')

console.log('\n  Доступ работает.\n')
