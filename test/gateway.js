/**
 * Проверка переводчика между агентом и шлюзом.
 *
 * Всё без сети и без ключа: проверяются только преобразования форм.
 * Ошибка здесь стоила бы дорого — агент молча перестал бы вызывать
 * инструменты и писал бы отчёт из головы.
 *
 *   node test/gateway.js
 */
import assert from 'node:assert/strict'

import {
  toGatewayTools,
  toGatewayMessages,
  fromGatewayResponse,
} from '../src/gateway.js'

console.log('\n  Проверка шлюза\n')

// ── инструменты ──────────────────────────────────────────────────────────────

const tools = toGatewayTools([
  {
    name: 'check_meta',
    description: 'Проверяет мета-теги страницы.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
])

assert.equal(tools[0].type, 'function')
assert.equal(tools[0].function.name, 'check_meta')
assert.deepEqual(tools[0].function.parameters.required, ['url'], 'схема переносится целиком')
console.log('  ✓ инструменты описаны в форме OpenAI')

// ── переписка ────────────────────────────────────────────────────────────────

const messages = toGatewayMessages('Ты проверяешь сайты.', [
  { role: 'user', content: 'Проверь https://example.com/' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Начну с мета-тегов.' },
      { type: 'tool_use', id: 'call_1', name: 'check_meta', input: { url: 'https://example.com/' } },
      { type: 'tool_use', id: 'call_2', name: 'check_robots', input: { url: 'https://example.com/' } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'call_1', content: '{"findings":[]}' },
      { type: 'tool_result', tool_use_id: 'call_2', content: '{"findings":[]}' },
    ],
  },
])

assert.equal(messages[0].role, 'system', 'задание идёт отдельным сообщением')
assert.equal(messages[1].content, 'Проверь https://example.com/', 'простой текст не трогаем')

const assistant = messages[2]
assert.equal(assistant.content, 'Начну с мета-тегов.')
assert.equal(assistant.tool_calls.length, 2, 'оба вызова остались в одном сообщении')
assert.equal(assistant.tool_calls[0].function.arguments, '{"url":"https://example.com/"}')
console.log('  ✓ вызовы инструментов переносятся с аргументами строкой')

// Главное расхождение форматов: один ответ агента разворачивается в два
// сообщения роли tool, по одному на вызов.
assert.equal(messages.length, 5, 'два ответа инструментов дали два сообщения')
assert.equal(messages[3].role, 'tool')
assert.equal(messages[3].tool_call_id, 'call_1')
assert.equal(messages[4].tool_call_id, 'call_2')
console.log('  ✓ ответы инструментов разложены по отдельным сообщениям')

// ── ответ модели ─────────────────────────────────────────────────────────────

const withCall = fromGatewayResponse({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: 'Смотрю мета-теги.',
        tool_calls: [
          { id: 'call_9', function: { name: 'check_meta', arguments: '{"url":"https://example.com/"}' } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 869, completion_tokens: 171 },
})

assert.equal(withCall.stop_reason, 'tool_use', 'цикл должен пойти на второй круг')
assert.deepEqual(withCall.content[0], { type: 'text', text: 'Смотрю мета-теги.' })
assert.deepEqual(withCall.content[1], {
  type: 'tool_use',
  id: 'call_9',
  name: 'check_meta',
  input: { url: 'https://example.com/' },
})
assert.equal(withCall.usage.input_tokens, 869)
assert.equal(withCall.usage.output_tokens, 171)
console.log('  ✓ вызов инструмента и расход токенов читаются из ответа')

const plain = fromGatewayResponse({
  choices: [{ finish_reason: 'stop', message: { content: 'Отчёт готов.' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
})
assert.equal(plain.stop_reason, 'end_turn', 'без вызовов цикл останавливается')

const cut = fromGatewayResponse({
  choices: [{ finish_reason: 'length', message: { content: 'Не дописал' } }],
})
assert.equal(cut.stop_reason, 'max_tokens', 'обрыв по длине виден в отчёте')
assert.equal(cut.usage.input_tokens, 0, 'без расхода в ответе считаем нулём, а не падаем')
console.log('  ✓ конец ответа и обрыв по длине различаются')

// Испорченные аргументы не должны валить прогон: инструмент ответит ошибкой.
const broken = fromGatewayResponse({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: { tool_calls: [{ id: 'call_x', function: { name: 'check_meta', arguments: '{url:' } }] },
    },
  ],
})
assert.deepEqual(broken.content[0].input, {}, 'кривые аргументы дают пустой объект')
console.log('  ✓ повреждённые аргументы не роняют прогон')

console.log('\n  Шлюз работает.\n')
