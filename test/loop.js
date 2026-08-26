/**
 * Проверка цикла БЕЗ обращения к модели и без ключа.
 *
 * Вместо модели подставляем заглушку, которая ходит по заранее записанному
 * сценарию. Проверяем ровно механику:
 *
 *   - агент подключился к серверу и получил список инструментов;
 *   - заявка модели на вызов превратилась в настоящий вызов;
 *   - результат вернулся модели в правильном виде;
 *   - следующий круг увидел этот результат;
 *   - цикл остановился, когда модель перестала звать инструменты.
 *
 *   node test/loop.js
 */
import assert from 'node:assert/strict'
import { audit } from '../src/agent.js'

let seen = null

/**
 * Заглушка вместо модели. Ведёт себя как настоящая: на первом круге просит
 * вызвать robots, на втором — увидев ответ — просит проверить главную,
 * на третьем пишет отчёт.
 */
function scriptedModel() {
  let round = 0

  return async ({ system, tools, messages }) => {
    round += 1
    seen = { system, tools, messages: structuredClone(messages) }

    if (round === 1) {
      return {
        stop_reason: 'tool_use',
        usage: { input_tokens: 1000, output_tokens: 50 },
        content: [
          { type: 'text', text: 'Начну с robots.txt.' },
          { type: 'tool_use', id: 'call-1', name: 'check_robots', input: { url: 'https://example.com/' } },
        ],
      }
    }

    if (round === 2) {
      // Проверяем, что результат первого вызова действительно дошёл до модели
      const last = messages[messages.length - 1]
      assert.equal(last.role, 'user', 'результат должен приходить сообщением от имени пользователя')
      assert.equal(last.content[0].type, 'tool_result', 'результат должен быть блоком tool_result')
      assert.equal(last.content[0].tool_use_id, 'call-1', 'результат должен ссылаться на свою заявку')
      assert.ok(last.content[0].content.includes('robots.txt'), 'в результате должен быть ответ инструмента')

      return {
        stop_reason: 'tool_use',
        usage: { input_tokens: 2000, output_tokens: 80 },
        content: [
          { type: 'tool_use', id: 'call-2', name: 'check_url', input: { url: 'https://example.com/' } },
          { type: 'tool_use', id: 'call-3', name: 'check_meta', input: { url: 'https://example.com/' } },
        ],
      }
    }

    // Третий круг: два результата пришли ОДНИМ сообщением
    const last = messages[messages.length - 1]
    assert.equal(last.content.length, 2, 'оба результата должны прийти одним сообщением')
    assert.deepEqual(
      last.content.map((block) => block.tool_use_id).sort(),
      ['call-2', 'call-3'],
      'оба результата должны ссылаться на свои заявки',
    )

    return {
      stop_reason: 'end_turn',
      usage: { input_tokens: 3000, output_tokens: 400 },
      content: [{ type: 'text', text: 'Сайт в целом в порядке. Критичных находок нет.' }],
    }
  }
}

console.log('\n  Проверка цикла на заглушке вместо модели\n')

const steps = []
const result = await audit('https://example.com/', {
  createMessage: scriptedModel(),
  onStep: (event) => steps.push(event),
})

// ── что должно было произойти ────────────────────────────────────────────────
const connected = steps.find((event) => event.type === 'connected')
assert.ok(connected, 'агент должен подключиться к серверу')
// Список инструментов растёт, поэтому проверяем не точное число, а что нужные на месте
for (const name of ['check_url', 'check_meta', 'check_robots', 'check_sitemap', 'check_links']) {
  assert.ok(connected.tools.includes(name), `инструмент ${name} должен быть доступен агенту`)
}

assert.deepEqual(
  result.calls.map((call) => call.name),
  ['check_robots', 'check_url', 'check_meta'],
  'вызовы должны пройти в том порядке, в котором их просила модель',
)
assert.ok(
  result.calls.every((call) => call.ok),
  'все вызовы должны отработать без ошибки',
)

assert.equal(result.stoppedBy, 'end_turn', 'цикл должен остановиться сам, а не по лимиту')
assert.ok(result.report.includes('Сайт в целом'), 'отчёт должен быть текстом последнего ответа')

assert.equal(result.usage.inputTokens, 6000, 'токены должны складываться по всем кругам')
assert.equal(result.usage.outputTokens, 530)
assert.ok(result.usage.cost > 0, 'стоимость должна считаться')

// Список инструментов должен уехать модели в формате Messages API
const tool = seen.tools.find((item) => item.name === 'check_robots')
assert.ok(tool.description.length > 40, 'у инструмента должно быть описание для модели')
assert.equal(tool.input_schema.type, 'object', 'схема аргументов должна быть в поле input_schema')
assert.ok(tool.input_schema.properties.url, 'в схеме должен быть аргумент url')

console.log('  ✓ подключение к серверу и получение списка инструментов')
console.log('  ✓ заявка модели превращается в настоящий вызов')
console.log('  ✓ результат возвращается модели в правильном виде')
console.log('  ✓ несколько вызовов одного круга уходят одним сообщением')
console.log('  ✓ следующий круг видит результат предыдущего')
console.log('  ✓ цикл останавливается сам')
console.log('  ✓ токены и стоимость считаются')
console.log(`\n  Цикл работает. Вызовов: ${result.calls.length}, кругов: 3.\n`)
