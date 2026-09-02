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
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { SEVERITY_LABELS, SEVERITIES } from './rules/index.js'
import { gatewayCaller } from './gateway.js'

/**
 * Имя модели читается по месту, а не при загрузке файла.
 *
 * Модуль загружается раньше, чем подключается .env, поэтому запись на верхнем
 * уровне брала бы значение до его появления и переменная из файла молча
 * не работала бы.
 */
function currentModel() {
  return process.env.REVIZOR_MODEL || 'claude-opus-5'
}

/**
 * Цена за миллион токенов. У прямого доступа к Anthropic счёт в долларах,
 * у шлюза Timeweb — в рублях, поэтому валюта хранится рядом с ценой:
 * иначе в отчёте сложатся разные деньги под одним знаком.
 */
const PRICE = {
  'claude-opus-5': { input: 5, output: 25, currency: '$' },
  'claude-haiku-4-5': { input: 1, output: 5, currency: '$' },
  'anthropic/claude-haiku-4-5': { input: 135, output: 1080, currency: '₽' },
}

/** Потолок на число кругов: страховка от бесконечного цикла. */
const MAX_STEPS = 14

/**
 * Задание для агента лежит в AGENT.md, а не в коде.
 *
 * Причина та же, что и с чек-листом: правила работы приходится править часто,
 * и делать это в тексте удобнее, чем в исходнике. Плюс тот же файл читает
 * Claude Code, если попросить его следовать инструкции — правила не разъезжаются.
 */
function readInstruction() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const raw = readFileSync(path.join(here, '..', 'AGENT.md'), 'utf8')

  // Отрезаем шапку про то, кто этот файл читает: агенту она не нужна
  const marker = raw.indexOf('---')
  return (marker >= 0 ? raw.slice(marker + 3) : raw).trim()
}

const SYSTEM = readInstruction()

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

/**
 * Вытаскивает находки из ответа инструмента и складывает в общую копилку.
 *
 * Ключ — правило плюс адрес: одна и та же беда на двух страницах это две
 * находки, а на одной странице дважды — одна. По этому же ключу потом
 * сравниваются два прогона.
 */
function collect(text, call, findings, pages) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return
  }

  const url = data.finalUrl || data.url || call.input?.url
  if (url) pages.add(url)

  for (const finding of data.findings || []) {
    const key = `${finding.id}@${url}`
    if (!findings.has(key)) findings.set(key, { ...finding, url, tool: call.name })
  }
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
export function defaultCaller() {
  // Ключ шлюза важнее: если он задан, значит доступ к Anthropic напрямую
  // либо не настроен, либо не нужен.
  return process.env.AI_GATEWAY_KEY ? gatewayCaller() : anthropicCaller()
}

export function anthropicCaller() {
  const anthropic = new Anthropic()

  return (request) =>
    anthropic.beta.messages.create({
      model: currentModel(),
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
  const { onStep = () => {}, maxSteps = MAX_STEPS, createMessage = defaultCaller() } = options
  const model = currentModel()

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
  // Находки собираем сами из ответов инструментов. Модель пишет связный текст,
  // но для сравнения прогонов нужны данные с постоянными идентификаторами,
  // а не пересказ.
  const findings = new Map()
  const pages = new Set()

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
        collect(text, call, findings, pages)
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

  const price = PRICE[model]
  const cost = price ? (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output : null

  const collected = [...findings.values()].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  )

  return {
    site,
    model,
    finishedAt: new Date().toISOString(),
    report,
    findings: collected,
    pages: [...pages],
    calls,
    stoppedBy,
    usage: { inputTokens, outputTokens, cost, currency: price?.currency || '$' },
  }
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
