/**
 * Печать HTML в PDF.
 *
 * Без единой новой зависимости: у Chrome есть встроенный ключ --print-to-pdf.
 * Альтернатива — притащить Puppeteer, а с ним ещё двести мегабайт своего
 * браузера. Для одной задачи это перебор, тем более что браузер уже стоит.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Где обычно лежит браузер на Windows и на других системах. */
const CANDIDATES = [
  process.env.REVIZOR_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean)

/** Возвращает путь к браузеру или null, если не нашли. */
export function findBrowser() {
  return CANDIDATES.find((candidate) => existsSync(candidate)) || null
}

/**
 * Превращает готовый HTML-файл в PDF.
 *
 * @param {string} htmlPath  путь к HTML-файлу
 * @param {string} pdfPath   куда положить PDF
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export function htmlToPdf(htmlPath, pdfPath, options = {}) {
  const { timeoutMs = 60000 } = options
  const browser = findBrowser()

  if (!browser) {
    return Promise.resolve({
      ok: false,
      reason:
        'Не нашёл Chrome или Edge для печати в PDF. Укажите путь в переменной REVIZOR_BROWSER ' +
        'или откройте HTML-версию отчёта и напечатайте в PDF из браузера.',
    })
  }

  // file:// нужен абсолютный путь с прямыми слэшами
  const fileUrl = 'file:///' + path.resolve(htmlPath).replace(/\\/g, '/')

  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    `--print-to-pdf=${path.resolve(pdfPath)}`,
    fileUrl,
  ]

  return new Promise((resolve) => {
    const child = spawn(browser, args, { stdio: 'ignore' })

    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, reason: `Браузер не ответил за ${timeoutMs / 1000} с` })
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: `Не удалось запустить браузер: ${error.message}` })
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      if (existsSync(pdfPath)) {
        resolve({ ok: true, browser })
        return
      }
      resolve({ ok: false, reason: `Браузер завершился с кодом ${code}, файл не создан` })
    })
  })
}
