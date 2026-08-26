/**
 * Проверка одного адреса.
 *
 * Здесь НЕТ НИ СЛОВА про MCP. Это обычная функция: дали адрес — вернула данные.
 * Так сделано специально: логику можно запускать и тестировать отдельно,
 * не поднимая никакого сервера и не привлекая модель.
 */

/** Заголовки, которые интересны при аудите. Остальные не тащим, чтобы не засорять ответ. */
const INTERESTING_HEADERS = [
  'content-type',
  'last-modified',
  'server',
  'x-powered-by',
  'strict-transport-security',
  'content-encoding',
  'cache-control',
]

/**
 * Один запрос с повтором.
 *
 * Первое подключение к незнакомому хосту иногда не укладывается в стандартный
 * лимит, а со второй попытки проходит мгновенно. Без повтора живой сайт
 * периодически получал бы вердикт «не открылся» — для аудита это недопустимо.
 */
async function request(url, timeoutMs, attempts = 2) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // redirect: 'manual' — ключевой момент. По умолчанию fetch сам проходит
      // все редиректы, и мы бы увидели только конечную страницу. А нам нужна
      // именно цепочка: сколько шагов и куда ведёт каждый.
      return await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        // В заголовках HTTP допустима только латиница: кириллица здесь падает с ошибкой.
        headers: { 'user-agent': 'SEO-Revizor/0.1 (site audit bot)' },
      })
    } catch (error) {
      lastError = error
      // Таймаут по нашему сигналу — это уже вердикт, повторять смысла нет.
      if (error.name === 'TimeoutError') throw error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }

  throw lastError
}

/**
 * @param {string} url  полный адрес со схемой
 * @param {{maxHops?: number, timeoutMs?: number}} options
 */
export async function checkUrl(url, options = {}) {
  const { maxHops = 10, timeoutMs = 15000 } = options

  const startedAt = Date.now()
  const chain = []
  let current = url

  try {
    for (let hop = 0; hop <= maxHops; hop++) {
      const response = await request(current, timeoutMs)
      const location = response.headers.get('location')

      chain.push({
        url: current,
        status: response.status,
        location: location ? new URL(location, current).href : null,
      })

      // 3xx с заголовком Location — идём дальше по цепочке
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current).href

        if (chain.some((step) => step.url === next)) {
          return buildResult(url, chain, startedAt, null, [
            'Петля редиректов: адрес ссылается сам на себя по кругу.',
          ])
        }

        current = next
        continue
      }

      // дошли до конечной страницы
      const headers = {}
      for (const name of INTERESTING_HEADERS) {
        const value = response.headers.get(name)
        if (value) headers[name] = value
      }

      return buildResult(url, chain, startedAt, headers)
    }

    return buildResult(url, chain, startedAt, null, [
      `Больше ${maxHops} редиректов подряд — похоже на зацикливание.`,
    ])
  } catch (error) {
    return {
      url,
      ok: false,
      error:
        error.name === 'TimeoutError'
          ? `Нет ответа за ${timeoutMs} мс`
          : `${error.message || error}${error.cause?.code ? ` (${error.cause.code})` : ''}`,
      chain,
      responseMs: Date.now() - startedAt,
      notes: ['Адрес не открылся. Проверьте написание, DNS и доступность сервера.'],
    }
  }
}

/** Собирает итоговый ответ и формулирует замечания по чек-листу. */
function buildResult(requestedUrl, chain, startedAt, headers, extraNotes = []) {
  const last = chain[chain.length - 1] || {}
  const redirects = chain.length - 1
  const notes = [...extraNotes]

  if (headers) {
    if (redirects > 1) {
      notes.push(
        `Цепочка из ${redirects} редиректов. Должен быть один шаг: каждый лишний — потеря времени и части ссылочного веса.`,
      )
    }
    if (last.status >= 400) {
      notes.push(`Конечный адрес отдаёт ${last.status}. Если на него есть внутренние ссылки — это битая ссылка.`)
    }
    if (last.status === 200 && !headers['last-modified']) {
      notes.push('Нет заголовка Last-Modified. Поисковику труднее понять, что переобходить.')
    }
    if (headers['server'] && /\d/.test(headers['server'])) {
      notes.push(`Заголовок Server раскрывает версию: «${headers['server']}». По ней подбирают готовые уязвимости.`)
    }
    if (headers['x-powered-by']) {
      notes.push(`Заголовок X-Powered-By раскрывает платформу: «${headers['x-powered-by']}». Его принято убирать.`)
    }
    if (requestedUrl.startsWith('https://') && !headers['strict-transport-security']) {
      notes.push('Нет заголовка Strict-Transport-Security. Браузер не запомнит, что сайт открывается только по https.')
    }
    if (!headers['content-encoding']) {
      notes.push('Ответ пришёл без сжатия. Включение gzip или brotli обычно уменьшает объём в разы.')
    }
  }

  return {
    url: requestedUrl,
    ok: true,
    status: last.status ?? null,
    finalUrl: last.url ?? requestedUrl,
    redirects,
    chain,
    headers: headers || {},
    responseMs: Date.now() - startedAt,
    notes,
  }
}
