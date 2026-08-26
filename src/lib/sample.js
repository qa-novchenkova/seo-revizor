/**
 * Выбор страниц для выборочной проверки.
 *
 * Проверять всё подряд долго и не нужно: страницы одного типа сделаны по одному
 * шаблону, и ошибка в шаблоне видна на любой из них. А вот проверить только
 * первые адреса из карты — это почти наверняка десять записей блога подряд,
 * при том что каталог и карточку товара никто не посмотрит.
 *
 * Поэтому адреса группируются по «форме» пути, и из каждой группы берётся
 * представитель.
 */

/**
 * Форма пути: первый раздел плюс глубина вложенности.
 *
 *   /                              → '/'
 *   /about/                        → 'about, уровень 1'
 *   /catalog/tools/                → 'catalog, уровень 2'
 *   /catalog/tools/hammer/         → 'catalog, уровень 3'
 *
 * Две карточки товара попадут в одну группу, карточка и раздел — в разные.
 */
function shapeOf(url, originHost = null) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Чужой домен в карте — сам по себе находка, и путать его с главной нельзя
  if (originHost && parsed.host !== originHost) {
    return `другой домен: ${parsed.host}`
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (!segments.length) return '/'

  const section = segments[0].length > 24 ? segments[0].slice(0, 24) + '…' : segments[0]
  return `${section}, уровень ${segments.length}`
}

/**
 * @param {Array<{loc: string, lastmod?: string|null}>|string[]} items
 * @param {{limit?: number, origin?: string}} options
 * @returns {{groups: Array<{shape: string, total: number}>, pages: Array<{url: string, shape: string}>}}
 */
export function pickSample(items, options = {}) {
  const { limit = 8, origin = null } = options

  const urls = items.map((item) => (typeof item === 'string' ? item : item.loc)).filter(Boolean)

  let originHost = null
  if (origin) {
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
  }

  // Группируем по форме пути
  const groups = new Map()
  for (const url of urls) {
    const shape = shapeOf(url, originHost)
    if (!shape) continue
    if (!groups.has(shape)) groups.set(shape, [])
    groups.get(shape).push(url)
  }

  // Крупные группы важнее: это основные разделы сайта, а не единичные страницы
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

  const pages = []
  const taken = new Set()

  const add = (url, shape) => {
    if (!url || taken.has(url) || pages.length >= limit) return
    taken.add(url)
    pages.push({ url, shape })
  }

  // Главная идёт первой всегда: это самая важная страница сайта, и она может
  // вообще отсутствовать в карте.
  if (origin) add(origin, 'главная')
  const root = groups.get('/')
  if (root) add(root[0], 'главная')

  // По одному представителю из каждой группы
  for (const [shape, list] of ordered) {
    add(list[0], shape)
  }

  // Если места остались — добираем вторых представителей из крупных групп,
  // чтобы поймать расхождения внутри одного шаблона
  for (const [shape, list] of ordered) {
    if (pages.length >= limit) break
    if (list.length > 1) add(list[1], shape)
  }

  return {
    groups: ordered.map(([shape, list]) => ({ shape, total: list.length })),
    pages,
  }
}
