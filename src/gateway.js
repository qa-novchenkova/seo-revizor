/**
 * Переводчик между агентом и OpenAI-совместимым шлюзом.
 *
 * Цикл агента говорит на языке Anthropic: массив блоков content, вызовы
 * tool_use, ответы tool_result. Шлюз Timeweb говорит на языке OpenAI:
 * tool_calls внутри сообщения и отдельные сообщения роли tool.
 *
 * Перевод сделан на границе намеренно. Сам цикл — суть проекта, в нём видно,
 * как модель выбирает инструменты; переписывать его под каждого поставщика
 * значит размазать эту суть по коду. Здесь же меняется только форма запроса.
 *
 * Что теряется по сравнению с прямым доступом к Anthropic: размышления
 * (thinking) и запасная модель при упоре в предохранитель. На выбор
 * инструментов это не влияет.
 */

/** Полный аудит идёт долго, но один запрос к модели — нет. */
const TIMEOUT_MS = 120_000

/** Инструменты MCP в форме Anthropic → в форму OpenAI. */
export function toGatewayTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

/**
 * Переписка агента → сообщения OpenAI.
 *
 * Главное расхождение здесь: у Anthropic все ответы инструментов одного круга
 * лежат в одном сообщении, у OpenAI на каждый ответ нужно своё сообщение
 * роли tool. Поэтому одно сообщение агента может развернуться в несколько.
 */
export function toGatewayMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : []

  for (const message of messages) {
    // Обычный текст приходит строкой — переводить нечего.
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content })
      continue
    }

    if (message.role === 'assistant') {
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      const toolCalls = message.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        }))

      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') continue
      out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content })
    }
  }

  return out
}

/** Ответ OpenAI → ответ в той форме, которую ждёт цикл агента. */
export function fromGatewayResponse(data) {
  const choice = data.choices?.[0] || {}
  const message = choice.message || {}
  const content = []

  if (message.content) content.push({ type: 'text', text: message.content })

  for (const call of message.tool_calls || []) {
    let input = {}
    try {
      input = JSON.parse(call.function?.arguments || '{}')
    } catch {
      // Изредка модель присылает аргументы с изъяном. Пустой объект честнее
      // падения: инструмент ответит понятной ошибкой, и цикл поедет дальше.
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input })
  }

  return {
    content,
    stop_reason: stopReason(message, choice.finish_reason),
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  }
}

/**
 * Причина остановки. Цикл агента различает три случая: продолжать вызовы,
 * отказ модели и конец ответа. Всё остальное для него — конец ответа.
 */
function stopReason(message, finishReason) {
  if (message.tool_calls?.length) return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  if (finishReason === 'content_filter') return 'refusal'
  return 'end_turn'
}

/**
 * Обращение к шлюзу. Возвращает функцию той же формы, что и anthropicCaller,
 * поэтому цикл агента не знает, с кем разговаривает.
 */
export function gatewayCaller(options = {}) {
  const {
    key = process.env.AI_GATEWAY_KEY,
    url = process.env.AI_GATEWAY_URL,
    model = process.env.REVIZOR_MODEL,
    maxTokens = 8000,
  } = options

  return async ({ system, tools, messages }) => {
    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: toGatewayMessages(system, messages),
        tools: toGatewayTools(tools),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !data) {
      throw new Error(`Шлюз не ответил: ${data?.error?.message || response.status}`)
    }

    return fromGatewayResponse(data)
  }
}
