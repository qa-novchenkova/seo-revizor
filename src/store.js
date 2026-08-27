/**
 * Хранилище прогонов и сравнение с предыдущим.
 *
 * Ради этого мы и давали правилам постоянные идентификаторы. Сравниваются
 * не тексты отчётов, а находки по ключу «правило плюс адрес»: тогда видно,
 * что починили, что появилось и что тянется с прошлого раза.
 *
 * Это последний чек-лист из справочника — «проверки после внедрения».
 * Половина проблем в SEO появляется не сама по себе, а в момент выкладки.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/** Куда складываем прогоны. Папка в .gitignore: отчёты по чужим сайтам не наше дело. */
const ROOT = 'reports'

/** Имя папки для сайта: домен без схемы и служебных символов. */
export function folderFor(site) {
  try {
    return new URL(site).host.replace(/[^a-z0-9.-]/gi, '_')
  } catch {
    return site.replace(/[^a-z0-9.-]/gi, '_')
  }
}

/** Метка времени, пригодная для имени файла: 2026-08-27T14-30-05 */
function stamp(iso) {
  return iso.replace(/:/g, '-').replace(/\..+$/, '')
}

/**
 * Сохраняет прогон. Данные — в JSON, он нужен для следующего сравнения.
 * Документы для человека сохраняются рядом теми же именами.
 */
export function saveRun(run, documents = {}) {
  const dir = path.join(ROOT, folderFor(run.site))
  mkdirSync(dir, { recursive: true })

  const base = path.join(dir, stamp(run.finishedAt))
  const written = {}

  writeFileSync(`${base}.json`, JSON.stringify(run, null, 2), 'utf8')
  written.json = `${base}.json`

  for (const [extension, content] of Object.entries(documents)) {
    writeFileSync(`${base}.${extension}`, content, 'utf8')
    written[extension] = `${base}.${extension}`
  }

  return { dir, base, files: written }
}

/**
 * Предыдущий прогон по тому же сайту.
 * Берём последний по времени, не считая текущего.
 */
export function previousRun(site, exceptIso = null) {
  const dir = path.join(ROOT, folderFor(site))
  if (!existsSync(dir)) return null

  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()

  for (const name of files) {
    try {
      const run = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
      if (exceptIso && run.finishedAt === exceptIso) continue
      return run
    } catch {
      // повреждённый файл просто пропускаем
    }
  }

  return null
}

/**
 * Сравнение двух прогонов.
 *
 * Учитываем только страницы, проверенные в обоих прогонах. Иначе получится
 * ерунда: агент в этот раз не заглянул на /contacts, а мы отчитаемся,
 * что там всё починили.
 */
export function compare(current, previous) {
  if (!previous) return null

  const commonPages = new Set(
    (current.pages || []).filter((page) => (previous.pages || []).includes(page)),
  )

  const onCommon = (findings) =>
    (findings || []).filter((finding) => commonPages.has(finding.url))

  const nowKeys = new Map(onCommon(current.findings).map((f) => [`${f.id}@${f.url}`, f]))
  const wasKeys = new Map(onCommon(previous.findings).map((f) => [`${f.id}@${f.url}`, f]))

  const fixed = []
  const appeared = []
  const stayed = []

  for (const [key, finding] of wasKeys) {
    if (nowKeys.has(key)) stayed.push(finding)
    else fixed.push(finding)
  }
  for (const [key, finding] of nowKeys) {
    if (!wasKeys.has(key)) appeared.push(finding)
  }

  return {
    previousAt: previous.finishedAt,
    comparedPages: [...commonPages],
    skippedPages: (current.pages || []).filter((page) => !commonPages.has(page)),
    fixed,
    appeared,
    stayed,
  }
}
