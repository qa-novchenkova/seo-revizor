/**
 * Помощники для русских формулировок.
 *
 * Без этого в отчёте вылезает «21 символов» и «2 адресов». Мелочь, но отчёт
 * с такими ошибками нельзя показать клиенту.
 */

/**
 * Выбирает форму слова по числу.
 *
 *   plural(1,  ['символ', 'символа', 'символов'])  → 'символ'
 *   plural(2,  [...])                              → 'символа'
 *   plural(52, [...])                              → 'символов'
 *
 * @param {number} count
 * @param {[string, string, string]} forms  [1, 2–4, 5–20]
 */
export function plural(count, forms) {
  const absolute = Math.abs(count) % 100
  const last = absolute % 10

  if (absolute > 10 && absolute < 20) return forms[2]
  if (last > 1 && last < 5) return forms[1]
  if (last === 1) return forms[0]
  return forms[2]
}

/** То же самое, но сразу с числом: «52 символа». */
export function counted(count, forms) {
  return `${count} ${plural(count, forms)}`
}

/** Готовые наборы форм, чтобы не повторять их по файлам. */
export const FORMS = {
  symbol: ['символ', 'символа', 'символов'],
  address: ['адрес', 'адреса', 'адресов'],
  heading: ['заголовок', 'заголовка', 'заголовков'],
  redirect: ['редирект', 'редиректа', 'редиректов'],
  image: ['изображение', 'изображения', 'изображений'],
  map: ['карта', 'карты', 'карт'],
  page: ['страница', 'страницы', 'страниц'],
}
