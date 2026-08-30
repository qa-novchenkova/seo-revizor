/**
 * Иконки для страницы проекта.
 *
 * Рисуются линиями в сетке 24×24 и красятся текущим цветом текста,
 * поэтому одна иконка одинаково хорошо ложится и на светлый фон, и на тёмный.
 * Картинок в проекте нет вообще: всё это разметка, которая ничего не весит
 * и не требует отдельной загрузки.
 */

/** Внутренности каждой иконки. Обводка и размеры задаются снаружи, в стилях. */
const SHAPES = {
  // ── инструменты ───────────────────────────────────────────────────────────
  url: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',

  meta: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z"/><circle cx="7.6" cy="7.6" r="1.3"/>',

  robots:
    '<rect x="4" y="9" width="16" height="11" rx="3"/><path d="M12 9V5"/><circle cx="12" cy="3.6" r="1.4"/>' +
    '<circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/><path d="M9.5 17.4h5"/>',

  sitemap:
    '<rect x="9" y="2.6" width="6" height="5" rx="1.4"/><rect x="2.6" y="16.4" width="6" height="5" rx="1.4"/>' +
    '<rect x="15.4" y="16.4" width="6" height="5" rx="1.4"/><path d="M12 7.6v4.2M5.6 16.4v-2.3h12.8v2.3M12 11.8v2.3"/>',

  links:
    '<path d="M10.6 13.4a4.4 4.4 0 0 0 6.6.5l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.5 1.5"/>' +
    '<path d="M13.4 10.6a4.4 4.4 0 0 0-6.6-.5l-2.6 2.6a4.4 4.4 0 0 0 6.2 6.2l1.5-1.5"/>',

  mirrors:
    '<rect x="3" y="3" width="9" height="9" rx="2"/><rect x="12" y="12" width="9" height="9" rx="2"/>' +
    '<path d="M12 7.5h4.5a2 2 0 0 1 2 2V12M12 16.5H7.5a2 2 0 0 1-2-2V12"/>',

  security:
    '<path d="M12 21.4s7.4-3.7 7.4-9.2V5.4L12 2.6 4.6 5.4v6.8c0 5.5 7.4 9.2 7.4 9.2z"/><path d="m8.8 11.8 2.2 2.2 4.2-4.2"/>',

  analytics:
    '<path d="M3 20.6h18"/><rect x="4.6" y="12" width="3.4" height="6.4" rx="1"/>' +
    '<rect x="10.3" y="7.6" width="3.4" height="10.8" rx="1"/><rect x="16" y="3.6" width="3.4" height="14.8" rx="1"/>',

  content:
    '<path d="M8 2.6h6.6L19.4 7v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4.6a2 2 0 0 1 2-2z"/>' +
    '<path d="M14.2 2.8V7h4.4"/><path d="M9.4 12h6.2M9.4 15.4h6.2M9.4 18h3.6"/>',

  speed:
    '<path d="M3.6 18a9 9 0 1 1 16.8 0"/><path d="m12 14.4 4-4.6"/><circle cx="12" cy="15.4" r="1.6"/>' +
    '<path d="M3.6 18h2M18.4 18h2"/>',

  rules:
    '<rect x="4" y="3" width="16" height="18" rx="2.4"/><path d="m7.8 9 1.6 1.6L12.4 7.6"/>' +
    '<path d="m7.8 15.4 1.6 1.6 3-3"/><path d="M14.6 9.6h3.2M14.6 16h3.2"/>',

  // ── разделы чек-листа ─────────────────────────────────────────────────────
  index: '<path d="M12 2.6 2.6 7.4 12 12.2l9.4-4.8L12 2.6z"/><path d="m2.6 12.2 9.4 4.8 9.4-4.8"/><path d="m2.6 16.8 9.4 4.8 9.4-4.8"/>',

  onpage: '<path d="M5 4.6h14"/><path d="M12 4.6v15"/><path d="M8.6 19.6h6.8"/><path d="M5 4.6v2.8M19 4.6v2.8"/>',

  mobile:
    '<rect x="6.4" y="2.6" width="11.2" height="18.8" rx="2.6"/><path d="M10.4 5.4h3.2"/><path d="M11 18.4h2"/>',

  ux: '<path d="M5.4 3.6 19 9.4l-5.6 2.2-2.2 5.6-5.8-13.6z"/><path d="m13.6 13.6 5 5"/>',

  competitors:
    '<path d="M4.6 20.4V9.6l3-6h3l-1.4 6"/><path d="M19.4 20.4V9.6l-3-6h-3l1.4 6"/>' +
    '<path d="M4.6 12.4h4.8M14.6 12.4h4.8"/><path d="M9.4 20.4h5.2"/>',

  regress:
    '<path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1"/><path d="M20.6 3.4v5h-5"/><path d="M12 7.6V12l3 1.8"/>',

  // ── прочее ────────────────────────────────────────────────────────────────
  menu: '<path d="M4 6.8h16"/><path d="M4 12h16"/><path d="M4 17.2h16"/>',
  close: '<path d="M6.2 6.2 17.8 17.8"/><path d="M17.8 6.2 6.2 17.8"/>',
  check: '<path d="m4.6 12.6 4.8 4.8 10-10.4"/>',
  eye: '<path d="M2.6 12S6.4 5.4 12 5.4 21.4 12 21.4 12 17.6 18.6 12 18.6 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.8"/>',
  cloud: '<path d="M7 18.4a4.4 4.4 0 0 1-.5-8.8 5.6 5.6 0 0 1 10.8-1.2A3.8 3.8 0 0 1 17.6 18.4z"/>',
  spark: '<path d="M12 2.6 14 9l6.4 2-6.4 2-2 6.4-2-6.4L3.6 11 10 9l2-6.4z"/>',
  code: '<path d="m8.6 7.4-5 4.6 5 4.6"/><path d="m15.4 7.4 5 4.6-5 4.6"/><path d="m13.6 4.6-3.2 14.8"/>',
  bot: '<rect x="3.6" y="8" width="16.8" height="12.4" rx="3"/><path d="M12 8V4.4"/><circle cx="12" cy="3" r="1.4"/><circle cx="8.6" cy="13.6" r="1.3"/><circle cx="15.4" cy="13.6" r="1.3"/>',
  github:
    '<path d="M9.4 20.6c-4.6 1.4-4.6-2.4-6.4-2.8m12.8 5.2v-3.6c0-1 .1-1.4-.5-2 2.6-.3 5-1.3 5-5.6a4.4 4.4 0 0 0-1.2-3 4 4 0 0 0-.1-3s-1-.3-3.3 1.2a11.4 11.4 0 0 0-6 0C7.4 5.5 6.4 5.8 6.4 5.8a4 4 0 0 0-.1 3 4.4 4.4 0 0 0-1.2 3.1c0 4.3 2.4 5.3 5 5.6-.6.6-.6 1.2-.5 2v3.5"/>',
}

/**
 * Возвращает готовую иконку.
 * @param {string} name  имя из списка выше
 * @param {string} extra дополнительные классы
 */
export function icon(name, extra = '') {
  const shape = SHAPES[name]
  if (!shape) throw new Error(`Иконки «${name}» нет — проверьте имя`)

  return (
    `<svg class="ico ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`
  )
}

/** Какая иконка какому инструменту. */
export const TOOL_ICONS = {
  check_url: 'url',
  check_meta: 'meta',
  check_robots: 'robots',
  check_sitemap: 'sitemap',
  check_links: 'links',
  check_mirrors: 'mirrors',
  check_security: 'security',
  check_analytics: 'analytics',
  check_content: 'content',
  check_speed: 'speed',
  list_rules: 'rules',
}

/** Какая иконка какому разделу чек-листа. */
export const SECTION_ICONS = {
  index: 'index',
  onpage: 'onpage',
  content: 'content',
  speed: 'speed',
  mobile: 'mobile',
  ux: 'ux',
  security: 'security',
  analytics: 'analytics',
  competitors: 'competitors',
  regress: 'regress',
}

/**
 * Свой цвет каждому разделу: первый для светлой темы, второй для тёмной.
 * На тёмном фоне те же краски выглядят грязными, поэтому их приходится
 * брать посветлее — иначе половина разделов сливается в бурое пятно.
 */
export const SECTION_TONES = {
  index: ['#1D63D2', '#7FB0FF'],
  onpage: ['#6D28D9', '#BFA0FF'],
  content: ['#BE1D64', '#FF9EC4'],
  speed: ['#C2410C', '#FFAB78'],
  mobile: ['#0E7490', '#67D8F0'],
  ux: ['#946200', '#F2C24B'],
  security: ['#B91C1C', '#FF9B9B'],
  analytics: ['#15803D', '#79D69B'],
  competitors: ['#4338CA', '#A9B0FF'],
  regress: ['#0F766E', '#67CFC4'],
}
