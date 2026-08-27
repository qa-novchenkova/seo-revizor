/**
 * Общий сетевой слой для всех проверок.
 *
 * Раньше эта логика жила внутри url.js. Инструментов стало больше, и повтор
 * запроса, таймаут и user-agent нужны каждому — поэтому вынесены сюда.
 */

// В заголовках HTTP допустима только латиница: кириллица падает с ошибкой.
const USER_AGENT = 'SEO-Revizor/0.2 (site audit bot)'

/** Ограничение на объём скачиваемого, чтобы не подавиться большим файлом. */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Один запрос с повтором.
 *
 * Первое подключение к незнакомому хосту иногда не укладывается в стандартный
 * лимит, а со второй попытки проходит мгновенно. Без повтора живой сайт
 * периодически получал бы вердикт «не открылся».
 */
export async function request(url, options = {}) {
  const { timeoutMs = 15000, attempts = 2, redirect = 'manual' } = options
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, {
        redirect,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': USER_AGENT },
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
 * Скачивает адрес целиком, проходя редиректы автоматически.
 * Возвращает текст и то, чем ответил сервер.
 */
export async function fetchText(url, options = {}) {
  const response = await request(url, { ...options, redirect: 'follow' })

  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_BYTES) {
    return {
      ok: false,
      status: response.status,
      finalUrl: response.url || url,
      body: '',
      headers: response.headers,
      error: `Файл слишком большой: ${Math.round(length / 1024)} КБ`,
    }
  }

  const body = await response.text()

  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url || url,
    body: body.slice(0, MAX_BYTES),
    headers: response.headers,
  }
}

/**
 * Коды, которыми сервер просит притормозить.
 *
 * Их нельзя трактовать как ответ по существу. Один раз мы уже поймали на этом
 * одиннадцать «битых» ссылок, которые оказались живыми: сайт просто защищался
 * от слишком частых запросов. В аудите такая ошибка дороже пропуска.
 */
export const THROTTLED = new Set([429, 503])

export const isThrottled = (status) => THROTTLED.has(status)

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Один запрос без прохода по переадресациям, с повтором при просьбе притормозить.
 *
 * @returns {{reachable: boolean, status: number|null, location: string|null, throttled: boolean}}
 */
export async function probe(url, options = {}) {
  const { timeoutMs = 15000, retryPauseMs = 1200 } = options

  try {
    let response = await request(url, { timeoutMs, redirect: 'manual' })

    if (isThrottled(response.status)) {
      await sleep(retryPauseMs)
      response = await request(url, { timeoutMs, redirect: 'manual' })
    }

    return {
      reachable: true,
      status: response.status,
      location: response.headers.get('location'),
      throttled: isThrottled(response.status),
      headers: response.headers,
    }
  } catch (error) {
    return { reachable: false, status: null, location: null, throttled: false, error }
  }
}

/** Приводит ошибку сети к понятному человеку тексту. */
export function describeError(error, timeoutMs = 15000) {
  if (error.name === 'TimeoutError') return `Нет ответа за ${timeoutMs} мс`
  return `${error.message || error}${error.cause?.code ? ` (${error.cause.code})` : ''}`
}

/** Собирает корень сайта из любого адреса: https://site.ru/ */
export function originOf(url) {
  return new URL(url).origin + '/'
}
