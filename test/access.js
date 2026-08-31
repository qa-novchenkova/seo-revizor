/**
 * Проверка доступа по коду и общего потолка.
 *
 * Оба берутся из переменных окружения при загрузке файла, поэтому здесь
 * они задаются до импорта бота, а не в самом тесте.
 *
 *   node test/access.js
 */
import assert from 'node:assert/strict'

process.env.BOT_ACCESS_CODE = 'ревизор-2026'
process.env.BOT_GLOBAL_DAILY_LIMIT = '3'

const { accessState, checkGlobalLimit, spendGlobal, resetAccess } = await import('../src/bot.js')

console.log('\n  Проверка доступа по коду\n')

resetAccess()

// ── код ──────────────────────────────────────────────────────────────────────

assert.equal(accessState('чужой', 'привет'), 'locked', 'без кода посторонний не проходит')
assert.equal(accessState('чужой', 'https://example.com'), 'locked', 'адрес кодом не является')
console.log('  ✓ без кода бот не пускает')

assert.equal(accessState('гость', 'ревизор-2026'), 'code', 'верный код открывает доступ')
assert.equal(accessState('гость', ' Ревизор-2026 '), 'code', 'регистр и пробелы не должны мешать')
console.log('  ✓ код принимается независимо от регистра и пробелов')

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
