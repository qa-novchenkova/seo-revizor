/**
 * Агент-ревизор.
 *
 * Здесь появляется то, чего не было на прошлых этапах: порядок вызовов
 * выбирает модель, а не мы. Мы задаём только задачу и правила игры.
 *
 * Цикл выглядит так:
 *
 *   1. спрашиваем у своего MCP-сервера список инструментов
 *   2. отправляем модели задачу вместе с этим списком
 *   3. модель отвечает: «вызови вот этот инструмент с такими аргументами»
 *   4. вызываем, возвращаем результат модели
 *   5. модель смотрит на результат и решает: звать ещё или писать отчёт
 *   6. если звать — возвращаемся к шагу 3
 *
 * Цикл написан руками, а не взят готовым, ровно чтобы каждый шаг был виден
 * в коде и в выводе. Готовый помощник спрятал бы всё это внутри себя.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { SEVERITY_LABELS } from './rules/index.js'

const MODEL = process.env.REVIZOR_MODEL || 'claude-opus-5'

/** Цена за миллион токенов, чтобы показывать стоимость прогона. */
const PRICE = { 'claude-opus-5': { input: 5, output: 25 }, 'claude-haiku-4-5': { input: 1, output: 5 } }

/** Потолок на число кругов: страховка от бесконечного цикла. */
const MAX_STEPS = 14

const SYSTEM = `Ты SEO-ревизор. Проверяешь сайт по чек-листу и собираешь отчёт для владельца сайта.

Порядок работы:
1. Начни с check_robots. Там находятся самые тяжёлые ошибки, и оттуда же выясняется адрес карты сайта.
2. Если карта есть — вызови check_sitemap. Для дальнейшей проверки бери адреса из поля sample: это по одной странице каждого типа. Не бери первые адреса из общего списка urls — так проверишь десять однотипных страниц.
3. Проверь через check_url и check_meta от двух до четырёх страниц из выборки, обязательно включая главную.
4. Если увиденное вызывает подозрение — проверь дополнительно. Например, при странном canonical посмотри соседнюю страницу того же типа.
5. Когда данных достаточно, остановись и напиши отчёт. Не гонись за полнотой: четыре-восемь вызовов обычно хватает.

Отчёт по-русски, в таком порядке:
- один абзац об общем состоянии сайта;
- находки по важности, сначала критичные: что не так, на каких страницах, что делать;
- в конце коротко: что стоит проверить руками, потому что инструменты этого не умеют.

Строгие правила:
- Пиши только то, что вернули инструменты. Ничего не додумывай и не предполагай.
- Если инструмент вернул ошибку, так и скажи, а не делай вид, что проверил.
- Не пересказывай JSON. Пиши человеческим языком, по делу, без воды и без похвалы.`

/** Инструменты MCP переводим в формат, который понимает Messages API. */
function toApiTools(mcpTools) {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

/** Достаёт из ответа инструмента текст: там лежит JSON строкой. */
function textOf(result) {
  return (result.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function short(value, max = 90) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/**
 * Обращение к модели вынесено отдельной функцией по одной причине:
 * так цикл можно проверить, подставив вместо модели заглушку.
 * Иначе каждый запуск теста стоил бы денег и требовал ключа.
 */
export function anthropicCaller() {
  const anthropic = new Anthropic()

  return (request) =>
    anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      // Если запрос упрётся в предохранитель модели, ответ подхватит запасная,
      // а не оборвётся на полуслове.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...request,
    })
}

export async function audit(site, options = {}) {
  const { onStep = () => {}, maxSteps = MAX_STEPS, createMessage = anthropicCaller() } = options

  const root = path.dirname(fileURLToPath(import.meta.url))

  // ── подключаемся к своему серверу как обычный клиент ──────────────────────
  // Это та самая вторая половина SDK. Раньше мы писали её вручную в test/mcp.js,
  // теперь берём готовую: connect, listTools, callTool.
  const mcp = new Client({ name: 'revizor-agent', version: '0.4.0' })
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'server.js')],
    }),
  )

  const { tools: mcpTools } = await mcp.listTools()
  const tools = toApiTools(mcpTools)
  onStep({ type: 'connected', tools: mcpTools.map((tool) => tool.name) })

  // ── цикл ─────────────────────────────────────────────────────────────────
  const messages = [{ role: 'user', content: `Проверь сайт ${site} и напиши отчёт.` }]

  const calls = []
  let inputTokens = 0
  let outputTokens = 0
  let report = ''
  let stoppedBy = 'end_turn'

  for (let step = 1; step <= maxSteps; step++) {
    const response = await createMessage({ system: SYSTEM, tools, messages })

    inputTokens += response.usage.input_tokens
    outputTokens += response.usage.output_tokens

    // Модель может отказаться отвечать — это не ошибка сети, а штатный ответ.
    if (response.stop_reason === 'refusal') {
      stoppedBy = 'refusal'
      report = 'Модель отказалась выполнять запрос.'
      break
    }

    const said = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (response.stop_reason !== 'tool_use') {
      report = said
      stoppedBy = response.stop_reason
      break
    }

    if (said) onStep({ type: 'thought', text: said })

    messages.push({ role: 'assistant', content: response.content })

    // Все вызовы одного круга выполняем и возвращаем ОДНИМ сообщением:
    // если разбить на несколько, модель перестанет вызывать инструменты пачками.
    const requested = response.content.filter((block) => block.type === 'tool_use')
    const results = []

    for (const call of requested) {
      onStep({ type: 'call', step, name: call.name, input: call.input })

      try {
        const answer = await mcp.callTool({ name: call.name, arguments: call.input })
        const text = textOf(answer)
        calls.push({ name: call.name, input: call.input, ok: !answer.isError })
        results.push({ type: 'tool_result', tool_use_id: call.id, content: text, is_error: !!answer.isError })
        onStep({ type: 'result', name: call.name, ok: !answer.isError, text })
      } catch (error) {
        calls.push({ name: call.name, input: call.input, ok: false })
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Инструмент не отработал: ${error.message || error}`,
          is_error: true,
        })
        onStep({ type: 'result', name: call.name, ok: false, text: String(error.message || error) })
      }
    }

    messages.push({ role: 'user', content: results })

    if (step === maxSteps) stoppedBy = 'limit'
  }

  await mcp.close()

  const price = PRICE[MODEL]
  const cost = price ? (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output : null

  return { site, model: MODEL, report, calls, stoppedBy, usage: { inputTokens, outputTokens, cost } }
}

/** Печать шагов, чтобы цикл было видно в реальном времени. */
export function consoleReporter() {
  return (event) => {
    if (event.type === 'connected') {
      console.log(`  инструментов доступно: ${event.tools.length} (${event.tools.join(', ')})\n`)
    }
    if (event.type === 'thought') {
      console.log(`  · ${event.text.replace(/\s+/g, ' ').slice(0, 160)}`)
    }
    if (event.type === 'call') {
      const args = Object.entries(event.input)
        .map(([key, value]) => `${key}=${short(value, 60)}`)
        .join(', ')
      console.log(`  шаг ${event.step}: ${event.name}(${args})`)
    }
    if (event.type === 'result') {
      if (!event.ok) {
        console.log(`     ошибка: ${short(event.text, 100)}`)
        return
      }
      try {
        const data = JSON.parse(event.text)
        const findings = data.findings || []

        if (!findings.length) {
          console.log('     замечаний нет')
          return
        }

        const counts = findings.reduce((acc, finding) => {
          acc[finding.severity] = (acc[finding.severity] || 0) + 1
          return acc
        }, {})
        const summary = Object.entries(counts)
          .map(([level, count]) => `${SEVERITY_LABELS[level]}: ${count}`)
          .join(', ')

        console.log(`     находок ${findings.length} (${summary})`)
      } catch {
        console.log('     ответ получен')
      }
    }
  }
}
