/**
 * Собирает страницу проекта в docs/index.html.
 *
 * Ничего не придумывает: всё содержимое берётся из тех же файлов,
 * по которым работает сам Ревизор.
 *
 *   инструменты  — из src/server.js, список TOOLS
 *   правила      — из src/rules/*.json
 *   порядок      — из src/order.json (машинная версия остаётся в AGENT.md)
 *   чек-листы    — из src/checklist/checklist.json
 *
 * Поэтому страница не может разойтись с кодом: поменяли правило —
 * пересобрали страницу, и она уже другая.
 *
 * Картинок нет ни одной: вся графика — разметка SVG, она ничего не весит,
 * не требует отдельной загрузки и одинаково резкая на любом экране.
 *
 *   npm run site
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOOLS } from '../src/server.js'
import { allRules, rulesByArea, SEVERITY_LABELS } from '../src/rules/index.js'
import { icon, TOOL_ICONS, SECTION_ICONS, SECTION_TONES } from './icons.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REPO = 'https://github.com/qa-novchenkova/seo-revizor'
const BOT_URL = 'https://t.me/SeoRevizorBot'

/** Как называется каждый вид проверки и что он означает. */
const KINDS = {
  auto: { label: 'авто', hint: 'выполняет сервер' },
  both: { label: 'авто + ручная', hint: 'данные собирает сервер, оценивает специалист' },
  manual: { label: 'ручная', hint: 'только ручная проверка' },
  service: { label: 'сервис', hint: 'нужны данные внешнего сервиса' },
}

// ── данные ───────────────────────────────────────────────────────────────────

const checklist = JSON.parse(readFileSync(path.join(root, 'src/checklist/checklist.json'), 'utf8'))
const glossary = JSON.parse(readFileSync(path.join(root, 'src/glossary.json'), 'utf8'))
const terms = glossary.groups.flatMap((group) => group.terms)
const rules = allRules()
const areas = rulesByArea()
const steps = JSON.parse(readFileSync(path.join(root, 'src/order.json'), 'utf8')).steps

// Порядок описан для читателя отдельно от AGENT.md, но ссылаться он должен
// на существующие инструменты: опечатка в имени иначе разойдётся с сервером.
for (const step of steps) {
  for (const name of step.tools) {
    if (!TOOLS.some((tool) => tool.name === name)) {
      throw new Error(`В src/order.json указан несуществующий инструмент «${name}»`)
    }
  }
}

const checks = checklist.sections.flatMap((section) => section.checks)
const automated = checks.filter(isMachine).length
const manual = checks.length - automated

function isMachine(check) {
  return check.kind === 'auto' || check.kind === 'both'
}


// ── сборка ───────────────────────────────────────────────────────────────────

const html = page()

mkdirSync(path.join(root, 'docs'), { recursive: true })
writeFileSync(path.join(root, 'docs/index.html'), html, 'utf8')

// Значки лежат в assets и копируются рядом со страницей: docs собирается
// заново при каждом коммите, поэтому держать их только там нельзя.
for (const [from, to] of [
  ['assets/favicon.svg', 'docs/favicon.svg'],
  ['assets/bot-avatar.png', 'docs/icon.png'],
]) {
  copyFileSync(path.join(root, from), path.join(root, to))
}

console.log(`  docs/index.html собран, ${Math.round(html.length / 1024)} КБ`)
console.log(`  инструментов ${TOOLS.length}, правил ${rules.length}, проверок ${checks.length}`)

// ── страница ─────────────────────────────────────────────────────────────────

function page() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ревизор — MCP-сервер и агент для проверки сайтов</title>
<meta name="description" content="Открытый MCP-сервер и автономный ИИ-агент для глубокого технического SEO-аудита сайтов. Автоматический поиск багов, ${checks.length} проверки и готовый отчёт по шагам.">
<meta property="og:title" content="ИИ-агент «Ревизор» — умный технический аудит сайтов">
<meta property="og:description" content="Автоматический аудит сайта по ${checks.length} критериям через протокол MCP. Находит SEO-ошибки, уязвимости и наглядно сравнивает отчёты после обновлений.">
<meta property="og:type" content="website">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon.png">
<meta name="theme-color" content="#0A1614">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>${style()}</style>
<script>
// Пометка «скрипты работают». Всё, что прячется до появления при прокрутке,
// прячется только при этой пометке: без скриптов страница просто видна целиком,
// а не остаётся пустой.
document.documentElement.className = 'js'
</script>
</head>
<body>
${nav()}
${hero()}
${ticker()}
<main>
${about()}
${toolsSection()}
${orderSection()}
${checklistSection()}
${rulesSection()}
${glossarySection()}
${botSection()}
${startSection()}
</main>
${footer()}
${toTop()}
<script>${script()}</script>
</body>
</html>
`
}

// ── шапка ────────────────────────────────────────────────────────────────────

function hero() {
  return `<header class="hero">
  <div class="hero__glow hero__glow--a"></div>
  <div class="hero__glow hero__glow--b"></div>
  <div class="hero__glow hero__glow--c"></div>

  <div class="wrap hero__in">
    <div class="hero__text">
      <p class="kicker">${icon('spark')} MCP-сервер · агент · открытый код</p>
      <h1>SEO-<em>ревизор</em></h1>
      <p class="lede">Глубокий аудит сайта по чек-листу из ${checks.length} параметров.
      Сканирует индексацию, зеркала, разметку, Core Web Vitals и безопасность.
      Вместо сухих логов вы получаете понятный отчёт:
      <b class="lede__line">суть проблемы → риски → готовое решение</b></p>

      <p class="cta">
        <a class="btn btn--main" href="${REPO}">${icon('github')} Открыть код</a>
        <a class="btn btn--ghost" href="#checklist">${icon('rules')} Смотреть чек-лист</a>
      </p>
    </div>

    ${scanner()}
  </div>

  <dl class="facts wrap">
    ${fact(TOOLS.length, 'инструментов сервера', 'code')}
    ${fact(rules.length, 'правил в чек-листе', 'rules')}
    ${fact(checks.length, 'пунктов аудита', 'check')}
    ${fact(automated, 'автопроверок', 'bot')}
  </dl>
</header>`
}

function fact(value, label, name) {
  return `<div class="fact">
    ${icon(name, 'fact__ico')}
    <dd><span class="num" data-count="${value}">${value}</span></dd>
    <dt>${esc(label)}</dt>
  </div>`
}

/** Картинка в шапке: страница, по которой сверху вниз идёт проверка. */
function scanner() {
  const lines = [
    [30, 150], [30, 110], [30, 172], [30, 92],
    [30, 160], [30, 128], [30, 178], [30, 104],
  ]

  const rows = lines
    .map(
      ([x, width], i) =>
        `<rect class="scan__line" x="${x}" y="${74 + i * 22}" width="${width}" height="8" rx="4"
         style="animation-delay:${(i * 0.42).toFixed(2)}s"/>`,
    )
    .join('')

  const marks = [0, 2, 4, 6]
    .map(
      (i) =>
        `<g class="scan__ok" style="animation-delay:${(i * 0.42 + 0.55).toFixed(2)}s">
        <circle cx="228" cy="${78 + i * 22}" r="8"/>
        <path d="m224.4 78.2 2.6 2.6 4.6-5"/>
      </g>`,
    )
    .join('')

  return `<div class="scan" aria-hidden="true">
  <svg viewBox="0 0 260 280" fill="none">
    <rect class="scan__frame" x="8" y="8" width="244" height="264" rx="16"/>
    <path class="scan__bar" d="M8 44h244"/>
    <circle class="scan__dot scan__dot--r" cx="28" cy="26" r="4.6"/>
    <circle class="scan__dot scan__dot--y" cx="44" cy="26" r="4.6"/>
    <circle class="scan__dot scan__dot--g" cx="60" cy="26" r="4.6"/>
    <rect class="scan__url" x="78" y="20" width="150" height="12" rx="6"/>
    ${rows}
    ${marks}
    <g class="scan__beam">
      <rect x="8" y="0" width="244" height="3" rx="1.5"/>
      <rect class="scan__haze" x="8" y="-26" width="244" height="26"/>
    </g>
  </svg>
</div>`
}

/** Бегущая строка: показывает разброс проверок одним взглядом. */
function ticker() {
  const picked = checklist.sections.flatMap((section) => section.checks.slice(0, 3).map((check) => check.title))

  const row = picked
    .map((title) => `<span class="tick">${icon('check', 'tick__ico')}${esc(title)}</span>`)
    .join('')

  // Лента дублируется, чтобы шов при зацикливании был не виден.
  return `<div class="ticker" aria-hidden="true"><div class="ticker__row">${row}${row}</div></div>`
}

function nav() {
  const items = [
    ['#about', 'О проблеме', 'code'],
    ['#tools', 'Инструменты', 'rules'],
    ['#order', 'Цикл агента', 'bot'],
    ['#checklist', 'Чек-листы', 'check'],
    ['#rules', 'Правила', 'content'],
    ['#glossary', 'Глоссарий', 'meta'],
    ['#bot', 'Телеграм-бот', 'send'],
    ['#start', 'Запуск', 'code'],
  ]

  return `<nav class="nav"><div class="wrap">
    <a class="nav__mark" href="#" aria-label="В начало страницы">${icon('security')} Ревизор</a>
    <button type="button" class="nav__burger" aria-expanded="false" aria-controls="nav-links" aria-label="Меню разделов">
      ${icon('menu', 'nav__burger-open')}${icon('close', 'nav__burger-close')}
    </button>
    <div class="nav__links" id="nav-links">
      ${items.map(([href, label, ic]) => `<a href="${href}">${icon(ic)}${esc(label)}</a>`).join('')}
    </div>
  </div></nav>`
}

// ── что это ──────────────────────────────────────────────────────────────────

function about() {
  const cards = [
    ['code', 'Сервер', 'Набор функций. Каждая проверяет свой участок и возвращает данные: коды ответа, заголовки, ссылки, показатели скорости.'],
    ['bot', 'Агент', 'Цикл. Выбирает следующую функцию по тому, что обнаружено на предыдущем шаге, и останавливается, когда данных достаточно.'],
    ['content', 'Отчёт', 'Markdown, HTML и PDF со сравнением с прошлой проверкой: что исправлено, что появилось, что осталось.'],
  ]

  return `<section class="sec" id="about"><div class="wrap">
  <h2 class="rise">О проблеме</h2>
  <p class="intro rise">Ручной аудит сайта — это десятки однообразных шагов. Из-за человеческого
  фактора легко пропустить критическую ошибку, например случайно запретить индексацию всего
  ресурса. SEO-агент автоматизирует этот процесс: он последовательно сканирует зеркала, метатеги,
  ссылки и файлы конфигурации, собирая точные данные без риска что-то упустить.</p>

  <div class="cards">
    ${cards
      .map(
        ([name, title, text], i) => `<article class="card rise" style="--wait:${i * 90}ms">
      <span class="card__ico">${icon(name)}</span>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
    </article>`,
      )
      .join('')}
  </div>

  <p class="note rise">${icon('eye', 'note__ico')}<span>Сервер работает на вашей машине и никуда
  данные не передаёт. Проверять чужой сайт без согласия владельца не следует: обход создаёт
  нагрузку.</span></p>
  </div></section>`
}

// ── инструменты ──────────────────────────────────────────────────────────────

function toolsSection() {
  return `<section class="sec sec--alt" id="tools"><div class="wrap">
  <h2 class="rise">Инструменты <span class="badge">${TOOLS.length}</span></h2>
  <p class="intro rise">Это точный список команд, которые ИИ-сервер использует для сканирования.
  Нейросеть сама изучает описания каждого инструмента и на лету решает, какую комбинацию
  запустить прямо сейчас, чтобы решить конкретную задачу на вашем сайте.</p>

  <div class="tools">
    ${TOOLS.map(
      (tool, i) => `<article class="tool rise" style="--wait:${(i % 3) * 80}ms">
      <span class="tool__ico">${icon(TOOL_ICONS[tool.name] || 'code')}</span>
      <h3>${esc(tool.title)}</h3>
      <code>${esc(tool.name)}</code>
      <p class="tool__row"><span>Что делает</span>${esc(tool.what)}</p>
      <p class="tool__row"><span>Зачем нужно</span>${esc(tool.why)}</p>
    </article>`,
    ).join('')}
  </div>
  </div></section>`
}

// ── порядок работы ───────────────────────────────────────────────────────────

function orderSection() {
  return `<section class="sec" id="order"><div class="wrap">
  <h2 class="rise">Как думает ИИ-агент</h2>
  <p class="intro intro--wide rise">Обычная нейросеть работает линейно: получает вопрос и сразу
  выдаёт один ответ. Агент «Ревизора» действует как мыслящий специалист, итерациями:</p>

  <ul class="beats beats--wide rise">
    <li>Анализирует ситуацию и выбирает подходящий инструмент.</li>
    <li>Изучает полученный результат и оценивает техническое состояние сайта.</li>
    <li>Принимает решение, достаточно ли данных или нужен следующий шаг.</li>
  </ul>

  <p class="intro intro--wide rise">Число таких циклов заранее предугадать невозможно: агент
  сканирует сайт до тех пор, пока полностью не закроет все пункты чек-листа.</p>

  ${loop()}

  <h3 class="sub rise">Порядок проверки</h3>
  <p class="intro rise">Последовательность выбрана не произвольно. Зеркала проверяются первыми:
  пока поисковая система видит вместо одного сайта несколько копий, остальные правки
  результата не дадут.</p>

  <ol class="order">
    ${steps
      .map(
        (step, i) => `<li class="rise" style="--wait:${Math.min(i, 6) * 50}ms">
      <h4>${esc(step.title)}${step.tools.map((name) => `<code>${esc(name)}</code>`).join('')}</h4>
      <p>${esc(step.text)}</p>
    </li>`,
      )
      .join('')}
  </ol>
  </div></section>`
}

/**
 * Схема цикла.
 *
 * Циклична здесь не вся цепочка, а только средние три шага: выбор инструмента,
 * вызов, оценка результата. Задача входит в цикл один раз, отчёт из него
 * выходит один раз. Точка бежит ровно по замкнутой части, а подписи вынесены
 * ниже линий, чтобы стрелки их не перекрывали.
 */
function loop() {
  const nodes = [
    [10, 150, '1', 'Задача', 'проверь сайт', 'enter'],
    [205, 170, '2', 'Выбор', 'какой инструмент вызвать', 'ring'],
    [420, 170, '3', 'Вызов', 'сервер выполняет проверку', 'ring'],
    [635, 170, '4', 'Оценка', 'данных хватает?', 'ring'],
  ]

  const boxes = nodes
    .map(
      ([x, width, step, title, note, kind], i) => `<g class="loop__node loop__node--${kind}" style="--wait:${i * 150}ms">
      <rect x="${x}" y="40" width="${width}" height="66" rx="13"/>
      <text x="${x + width / 2}" y="66" class="loop__t"><tspan class="loop__n">${step}</tspan> ${esc(title)}</text>
      <text x="${x + width / 2}" y="87" class="loop__s">${esc(note)}</text>
    </g>`,
    )
    .join('')

  return `<div class="loop rise">
  ${loopWide(boxes)}
  ${loopTall()}
</div>`
}

/** Широкая схема: боксы в строку, возврат петлёй снизу. Для больших экранов. */
function loopWide(boxes) {
  return `<svg class="loop__wide" viewBox="0 0 820 290" fill="none" role="img"
       aria-label="Схема работы агента. Задача входит в цикл. Внутри цикла три шага: выбор инструмента, вызов проверки, оценка данных. Если данных не хватает, цикл повторяется с выбора. Когда хватает, собирается отчёт.">
    <defs>
      <marker id="tip" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto">
        <path d="M0 0 10 5 0 10z" fill="currentColor"/>
      </marker>
    </defs>

    <rect class="loop__zone" x="192" y="26" width="626" height="162" rx="18"/>
    <text class="loop__zonelabel" x="806" y="46" text-anchor="end">цикл</text>

    ${boxes}

    <g class="loop__node loop__node--out" style="--wait:600ms">
      <rect x="635" y="200" width="170" height="52" rx="13"/>
      <text x="720" y="231" class="loop__t">Отчёт</text>
    </g>

    <g class="loop__wire">
      <path d="M160 73h38" marker-end="url(#tip)"/>
      <path d="M375 73h38" marker-end="url(#tip)"/>
      <path d="M590 73h38" marker-end="url(#tip)"/>
      <path d="M700 106 V148 H290 V113" marker-end="url(#tip)"/>
    </g>
    <g class="loop__wire loop__wire--out">
      <path d="M760 106 V194" marker-end="url(#tip)"/>
    </g>

    <circle class="loop__spark" r="6">
      <animateMotion dur="5.4s" repeatCount="indefinite" path="M290 73 H505 H700 V148 H290 Z"/>
    </circle>

    <text x="470" y="170" class="loop__note">данных мало — ещё круг</text>
    <text x="720" y="274" class="loop__note">данных хватает</text>
  </svg>`
}

/**
 * Высокая схема: те же шаги, но столбиком, возврат петлёй слева.
 * Нужна отдельная, а не уменьшенная широкая: на экране в 375 точек
 * та же схема ужалась бы до нечитаемого или уехала за край.
 */
function loopTall() {
  const nodes = [
    [6, 54, '1', 'Задача', 'проверь сайт', 'enter'],
    [98, 62, '2', 'Выбор', 'какой инструмент', 'ring'],
    [202, 62, '3', 'Вызов', 'сервер проверяет', 'ring'],
    [306, 62, '4', 'Оценка', 'данных хватает?', 'ring'],
  ]

  const boxes = nodes
    .map(
      ([y, height, step, title, note, kind]) => `<g class="loop__node loop__node--${kind}">
      <rect x="95" y="${y}" width="230" height="${height}" rx="13"/>
      <text x="210" y="${y + 26}" class="loop__t"><tspan class="loop__n">${step}</tspan> ${esc(title)}</text>
      <text x="210" y="${y + 46}" class="loop__s">${esc(note)}</text>
    </g>`,
    )
    .join('')

  return `<svg class="loop__tall" viewBox="0 0 340 512" fill="none" role="img"
       aria-label="Та же схема столбиком: задача входит в цикл, внутри — выбор инструмента, вызов проверки, оценка данных; при нехватке данных цикл повторяется, иначе собирается отчёт.">
    <defs>
      <marker id="tipTall" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto">
        <path d="M0 0 10 5 0 10z" fill="currentColor"/>
      </marker>
    </defs>

    <rect class="loop__zone" x="20" y="86" width="312" height="300" rx="18"/>
    <text class="loop__zonelabel" x="332" y="78" text-anchor="end">цикл</text>

    ${boxes}

    <g class="loop__node loop__node--out">
      <rect x="95" y="428" width="230" height="46" rx="13"/>
      <text x="210" y="456" class="loop__t">Отчёт</text>
    </g>

    <g class="loop__wire">
      <path d="M210 60 V94" marker-end="url(#tipTall)"/>
      <path d="M210 160 V198" marker-end="url(#tipTall)"/>
      <path d="M210 264 V302" marker-end="url(#tipTall)"/>
      <path d="M95 337 H56 V129 H91" marker-end="url(#tipTall)"/>
    </g>
    <g class="loop__wire loop__wire--out">
      <path d="M210 368 V424" marker-end="url(#tipTall)"/>
    </g>

    <circle class="loop__spark" r="6">
      <animateMotion dur="5.4s" repeatCount="indefinite" path="M210 129 V233 V337 H56 V129 Z"/>
    </circle>

    <text class="loop__note" transform="rotate(-90 40 233)" x="40" y="233">данных мало — ещё круг</text>
    <text x="210" y="496" class="loop__note">данных хватает</text>
  </svg>`
}

// ── чек-листы ────────────────────────────────────────────────────────────────

function checklistSection() {
  const legend = Object.entries(KINDS)
    .map(([kind, { label, hint }]) => `<li><span class="tag tag--${kind}">${esc(label)}</span> ${esc(hint)}</li>`)
    .join('')

  const chips = checklist.sections
    .map((section, i) => {
      const [light, dark] = SECTION_TONES[section.id] || ['#0F7A72', '#4FD1C3']
      return `<a class="chip${i === 0 ? ' on' : ''}" href="#cl-${section.id}"
      style="--tone:${light}; --tone-dark:${dark}">
      ${icon(SECTION_ICONS[section.id] || 'check')}${esc(section.title)}<b>${section.checks.length}</b>
    </a>`
    })
    .join('')

  return `<section class="sec sec--alt" id="checklist"><div class="wrap">
  <h2 class="rise">Чек-листы <span class="badge">${checks.length}</span></h2>
  <p class="intro rise">Полный список параметров аудита распределён по категориям во вкладках ниже.
  Для каждого дефекта детально расписаны риски и методика проверки.</p>

  <ul class="beats rise">
    <li><b>${automated}</b> проверок полностью автоматизированы силами ИИ-агента.</li>
    <li><b>${manual}</b> пунктов вынесены на ручной контроль. Это осознанное разделение: алгоритм
    мгновенно находит технические дефекты, но оценить, насколько заголовок категории соответствует
    её реальному содержимому, можно только человеческим взглядом.</li>
  </ul>

  <nav class="chips tabs rise" id="checklist-tabs" aria-label="Разделы чек-листа">${chips}</nav>

  <div class="filters rise" role="group" aria-label="Показать пункты по способу проверки">
    <span class="filters__label">Через все разделы:</span>
    <button type="button" data-filter="all">${icon('rules')} Все <b>${checks.length}</b></button>
    <button type="button" data-filter="machine">${icon('bot')} Автопроверки <b>${automated}</b></button>
    <button type="button" data-filter="human">${icon('eye')} Ручные <b>${manual}</b></button>
  </div>

  <ul class="legend rise">${legend}</ul>

  <div class="lists" data-view="tab">
    ${checklist.sections.map(checklistBlock).join('')}
  </div>
  </div></section>`
}

function checklistBlock(section, position) {
  const machine = section.checks.filter(isMachine).length
  const share = Math.round((machine / section.checks.length) * 100)
  const [light, dark] = SECTION_TONES[section.id] || ['#1A6F69', '#4FB8AF']

  // Открыт первый раздел. Остальные показываются по нажатию на вкладку —
  // иначе страница растягивается на все 142 пункта сразу.
  return `<section class="block rise${position === 0 ? ' open' : ''}" id="cl-${section.id}"
  data-machine="${machine}" data-human="${section.checks.length - machine}"
  style="--tone:${light}; --tone-dark:${dark}">
  <header class="block__head">
    <span class="block__ico">${icon(SECTION_ICONS[section.id] || 'check')}</span>
    <div class="block__title">
      <h3>${esc(section.title)} <span class="count">${section.checks.length}</span></h3>
      <p class="block__intro">${esc(section.intro)}</p>
    </div>
  </header>

  <div class="barline">
    <span class="bar" role="img" aria-label="Автоматизировано ${share} процентов пунктов раздела">
      <i class="bar__fill" style="--share:${share}%"></i>
    </span>
    <span class="bar__text"><b>${share}%</b> автоматизировано</span>
  </div>

  <ol class="checks">
    ${section.checks.map(checkItem).join('')}
  </ol>
  </section>`
}

function checkItem(check) {
  return `<li class="chk" data-side="${isMachine(check) ? 'machine' : 'human'}">
    <div class="chk__head">
      <h4>${esc(check.title)}</h4>
      <span class="tag tag--${check.kind}">${esc(KINDS[check.kind].label)}</span>
    </div>
    <p class="chk__why">${esc(check.why)}</p>
    <p class="chk__how"><span>Как проверить</span>${esc(check.how)}</p>
  </li>`
}

// ── правила ──────────────────────────────────────────────────────────────────

function rulesSection() {
  const counts = {}
  for (const rule of rules) counts[rule.severity] = (counts[rule.severity] || 0) + 1

  const top = Math.max(...areas.map((group) => group.total))
  const rows = areas
    .map(
      (group) => `<li>
      <span class="rule__name">${esc(group.area)}</span>
      <span class="rule__bar"><i style="--w:${Math.round((group.total / top) * 100)}%"></i></span>
      <span class="rule__num">${group.total}</span>
    </li>`,
    )
    .join('')

  const severities = Object.entries(counts)
    .map(
      ([level, count]) => `<div class="sevcard sevcard--${level}">
      <span class="sevcard__num">${count}</span>
      <span class="sevcard__label">${esc(SEVERITY_LABELS[level])}</span>
    </div>`,
    )
    .join('')

  // По одному примеру на каждую степень важности. Если правило переименуют,
  // сборка упадёт здесь, а не молча выкинет пример со страницы.
  const examples = ['no-counter', 'duplicate-title', 'description-equals-title']
    .map((id) => {
      const rule = rules.find((item) => item.id === id)
      if (!rule) throw new Error(`Правила «${id}» больше нет — поправьте список примеров`)
      return exampleFinding(rule)
    })
    .join('')

  return `<section class="sec" id="rules"><div class="wrap">
  <h2 class="rise">База правил <span class="badge">${rules.length}</span></h2>
  <p class="intro rise">Все формулировки замечаний отделены от программного кода и вынесены
  в независимые файлы данных, а каждому правилу присвоен постоянный идентификатор.
  Архитектура даёт два ключевых преимущества:</p>

  <ul class="beats rise">
    <li><b>Гибкость обновлений.</b> Тексты описаний, рисков и рекомендаций актуализируются
    мгновенно, без риска задеть или нарушить внутреннюю логику проверок.</li>
    <li><b>Наглядная история изменений.</b> Система сопоставляет результаты двух любых прогонов
    между собой. Видна динамика: какие дефекты успешно устранены, а какие ошибки появились
    после последнего обновления сайта.</li>
  </ul>

  <div class="sevs rise">${severities}</div>

  <ul class="rulebars rise">${rows}</ul>

  <h3 class="sub rise">Как выглядит ошибка в отчёте</h3>
  <p class="intro rise">Формат одинаков для всех правил: название дефекта,
  что именно обнаружено, чем это вредит и каким действием устраняется.</p>
  <div class="findings">${examples}</div>
  </div></section>`
}

function exampleFinding(rule) {
  return `<article class="finding finding--${rule.severity} rise">
    <div class="finding__head">
      <span class="sev">${esc(SEVERITY_LABELS[rule.severity])}</span>
      <h4>${esc(rule.title)}</h4>
    </div>
    <p class="finding__msg">${esc(rule.message)}</p>
    <p class="finding__row"><span>Чем вредит</span>${esc(rule.why)}</p>
    <p class="finding__row"><span>Как исправить</span>${esc(rule.fix)}</p>
  </article>`
}

// ── глоссарий ────────────────────────────────────────────────────────────────

function glossarySection() {
  const groups = glossary.groups
    .map(
      (group, i) => `<section class="gloss rise${i === 0 ? ' open' : ''}" id="gl-${group.id}" style="--wait:${(i % 2) * 70}ms">
    <h3>${esc(group.title)} <span class="count count--plain">${group.terms.length}</span></h3>
    <p class="gloss__intro">${esc(group.intro)}</p>
    <dl class="gloss__list">
      ${group.terms.map(termItem).join('')}
    </dl>
  </section>`,
    )
    .join('')

  const jump = glossary.groups
    .map(
      (group, i) =>
        `<a class="chip chip--plain${i === 0 ? ' on' : ''}" href="#gl-${group.id}">${esc(group.title)}<b>${group.terms.length}</b></a>`,
    )
    .join('')

  return `<section class="sec" id="glossary"><div class="wrap">
  <h2 class="rise">Глоссарий <span class="badge">${terms.length}</span></h2>
  <p class="intro rise">Термины из отчётов аудита и из описания проекта. Одни относятся
  к устройству агента, другие к техническому SEO. Без расшифровки строка вида
  «LCP 4,2 с при норме 2,5» владельцу сайта ничего не сообщает.</p>

  <nav class="chips tabs rise" id="gloss-tabs" aria-label="Разделы глоссария">${jump}</nav>

  <div class="glosses" data-view="tab">${groups}</div>
  </div></section>`
}

function termItem(item) {
  const full = item.full ? `<span class="gloss__full">${esc(item.full)}</span>` : ''
  return `<div class="gloss__item">
    <dt>${esc(item.term)}${full}</dt>
    <dd>${esc(item.text)}</dd>
  </div>`
}

// ── запуск ───────────────────────────────────────────────────────────────────

// ── телеграм-бот ─────────────────────────────────────────────────────────────

/**
 * Переписка с ботом: строки проверок появляются одна за другой, затем
 * приходят три файла отчёта. Рисуется в SVG, чтобы масштабировалась без
 * потери резкости и не тянула за собой скриншот весом в мегабайт.
 */
function chatMock() {
  const steps = [
    ['зеркала', '2 с'],
    ['robots.txt', '&lt;1 с'],
    ['карта сайта', '&lt;1 с'],
    ['ссылки', '2 с'],
    ['мета-теги', '1 с'],
    ['код ответа', '&lt;1 с'],
    ['безопасность', '3 с'],
    ['аналитика', '&lt;1 с'],
    ['контент и дубли', '1 с'],
    ['скорость', '9 с'],
  ]

  const rows = steps
    .map(([name, time], i) => {
      const y = 78 + i * 22
      const wait = (0.45 + i * 0.28).toFixed(2)
      return `<g class="chat__row" style="--at:${wait}s">
      <text class="chat__dot" x="26" y="${y}">·</text>
      <text class="chat__name" x="38" y="${y}">${name}</text>
      <text class="chat__time" x="${38 + name.length * 7.6 + 10}" y="${y}">— ${time}</text>
    </g>`
    })
    .join('')

  const files = [
    ['revizor-example.ru.pdf', '262 КБ', 'открыть и распечатать'],
    ['revizor-example.ru.html', '64 КБ', 'посмотреть в браузере'],
    ['revizor-example.ru.md', '40 КБ', 'положить в заметки'],
  ]
    .map(([name, size, hint], i) => {
      const y = 392 + i * 50
      const wait = (4.1 + i * 0.35).toFixed(2)
      return `<g class="chat__file" style="--at:${wait}s">
      <rect x="8" y="${y}" width="384" height="42" rx="12"/>
      <rect class="chat__badge" x="22" y="${y + 9}" width="24" height="24" rx="7"/>
      <path class="chat__badge-ico" d="M${30} ${y + 15}h8M30 ${y + 20}h8M30 ${y + 25}h5"/>
      <text class="chat__file-name" x="58" y="${y + 19}">${name}</text>
      <text class="chat__file-size" x="58" y="${y + 33}">${size} · ${hint}</text>
    </g>`
    })
    .join('')

  return `<div class="chat rise" aria-hidden="true">
  <svg viewBox="0 0 400 546" fill="none">
    <rect class="chat__bubble" x="8" y="8" width="384" height="366" rx="16"/>

    <text class="chat__head" x="26" y="40">Проверяю </text>
    <text class="chat__link" x="112" y="40">https://example.ru/</text>

    ${rows}

    <g class="chat__row" style="--at:3.4s">
      <text class="chat__done" x="26" y="318">готово за 1 мин 5 с</text>
    </g>
    <g class="chat__row" style="--at:3.7s">
      <text class="chat__pages" x="26" y="346">проверено на 5 страницах: /, /catalog, /about, /contacts, /policy</text>
    </g>

    ${files}
  </svg>
</div>`
}

function botSection() {
  const keys = [
    ['rules', 'Что проверяется', 'Полный перечень: индексация, зеркала, разметка, ссылки, безопасность, аналитика, контент, скорость.'],
    ['check', 'Мои лимиты', 'Сколько проверок осталось сегодня и когда снимется пауза между запусками.'],
    ['speed', 'Быстрые проверки', 'Перепроверить одно место после правки, не гоняя весь аудит.'],
  ]
    .map(
      ([ic, title, text], i) => `<article class="key rise" style="--wait:${i * 80}ms">
      ${icon(ic, 'key__ico')}
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
    </article>`,
    )
    .join('')

  const commands = [
    ['/speed', 'скорость и Core Web Vitals'],
    ['/security', 'сертификат, заголовки, служебные файлы'],
    ['/robots', 'robots.txt и карта сайта'],
    ['/meta', 'мета-теги одной страницы'],
    ['/limits', 'остаток проверок на сегодня'],
    ['/help', 'что именно проверяется'],
  ]
    .map(([cmd, text]) => `<li><code>${cmd}</code> <span>${esc(text)}</span></li>`)
    .join('')

  const modes = [
    [
      'bot',
      'С моделью',
      'Порядок проверок выбирает модель: увидела битую карту сайта — пошла смотреть, откуда берутся адреса. Сама решает, какие страницы взять в выборку, и объясняет находки словами, а не строкой из правила.',
      ['ключ доступа к модели', 'от 12 ₽ за проверку', 'минута-полторы'],
    ],
    [
      'code',
      'Без модели',
      'Те же одиннадцать инструментов и те же 113 правил, только порядок задан заранее. Ничего не выдумывается: находки собираются из ответов инструментов, заключение складывается по шаблону.',
      ['ничего, кроме сервера', 'бесплатно', 'полминуты'],
    ],
  ]
    .map(
      ([ic, title, text, facts], i) => `<article class="mode rise" style="--wait:${i * 90}ms">
      <h3>${icon(ic, 'mode__ico')}${esc(title)}</h3>
      <p>${esc(text)}</p>
      <dl class="mode__facts">
        <div><dt>нужно</dt><dd>${esc(facts[0])}</dd></div>
        <div><dt>стоимость</dt><dd>${esc(facts[1])}</dd></div>
        <div><dt>время прогона</dt><dd>${esc(facts[2])}</dd></div>
      </dl>
    </article>`,
    )
    .join('')

  const prices = [
    ['Haiku 4.5', '135 / 1080 ₽ за млн', '≈ 12 ₽', 'дешёвая, но обходит список не целиком'],
    ['Sonnet 5', '405 / 2025 ₽ за млн', '≈ 12 ₽', 'зовёт инструменты пачками, поэтому токенов тратит втрое меньше'],
    ['Opus', '675 / 3375 ₽ за млн', '≈ 90 ₽', 'для обхода чек-листа избыточна'],
  ]
    .map(
      ([model, rate, run, note]) => `<tr>
      <td><b>${esc(model)}</b></td><td class="mono">${esc(rate)}</td>
      <td class="mono">${esc(run)}</td><td>${esc(note)}</td>
    </tr>`,
    )
    .join('')

  return `<section class="sec sec--alt" id="bot"><div class="wrap">
  <h2 class="rise">Телеграм-бот</h2>
  <p class="intro rise">Тот же аудит без установки: присылаете адрес сайта — получаете отчёт.
  По ходу работы видно, что именно проверяется и сколько это заняло. В конце приходят три файла:
  PDF для печати, HTML для браузера, Markdown для заметок.</p>

  <p class="cta rise">
    <a class="btn btn--main" href="${BOT_URL}">${icon('send')} Открыть бота</a>
    <a class="btn btn--ghost" href="#start">${icon('code')} Поднять у себя</a>
  </p>

  <div class="botgrid">
    ${chatMock()}

    <div class="botside">
      <h3 class="sub rise">Постоянные кнопки</h3>
      <p class="rise">Три кнопки держатся над полем ввода и не уезжают вверх вместе с перепиской.</p>
      <div class="keys">${keys}</div>

      <h3 class="sub rise">Команды</h3>
      <p class="rise">Быстрые проверки отвечают за секунды, к модели не обращаются и на дневной
      лимит полного аудита не расходуются.</p>
      <ul class="cmds rise">${commands}</ul>
    </div>
  </div>

  <h3 class="sub rise">Два режима работы</h3>
  <p class="intro rise">Бот работает и с языковой моделью, и без неё. Режим выбирается наличием ключа
  в настройках: появился ключ — включается агент, убрали — проверки идут по заданному порядку.
  Проверки при этом настоящие в обоих случаях, разница в том, кто выбирает порядок.</p>

  <div class="modes">${modes}</div>

  <p class="note rise">${icon('eye', 'note__ico')}<span>Прогон без модели не заглушка. На демонстрационном
  магазине он находит 63 замечания против 21 у режима с моделью: фиксированный порядок берёт пять
  страниц всегда, а модель решает сама и иногда ограничивается двумя. Зато модель умеет отклоняться
  от списка, когда видит неладное, и пишет заключение человеческим языком.</span></p>

  <h3 class="sub rise">Сколько стоит прогон</h3>
  <p class="intro rise">Замеры на одном и том же сайте. Цена за проверку зависит не от цены модели,
  а от числа кругов диалога: на каждом круге переписка отправляется заново, поэтому модель,
  которая зовёт инструменты пачками, выходит дешевле экономной.</p>

  <div class="tablewrap rise">
    <table class="prices">
      <thead><tr><th>Модель</th><th>Входящие / исходящие</th><th>Прогон</th><th>Замечание</th></tr></thead>
      <tbody>${prices}</tbody>
    </table>
  </div>

  <h3 class="sub rise">Как поднять своего бота</h3>
  <p class="intro rise">Бот должен работать круглосуточно, поэтому ему нужен сервер: домашний
  компьютер выключается, а вместе с ним пропадает и бот. Подойдёт самый дешёвый виртуальный
  сервер с гигабайтом памяти.</p>

  <ol class="steps rise">
    <li>Получить токен бота у <code>@BotFather</code> в телеграме: команда <code>/newbot</code>.</li>
    <li>Взять виртуальный сервер, поставить Node.js 22 или новее и браузер Chrome — он собирает PDF.</li>
    <li>Отвести файл подкачки: при гигабайте памяти сборка PDF упирается в потолок без него.</li>
    <li>Забрать код с GitHub, создать файл <code>.env</code> и вписать туда токен бота.</li>
    <li>Оформить запуск службой системы: она поднимет бота после перезагрузки и после сбоя.</li>
  </ol>

  <p class="note rise">${icon('wallet', 'note__ico')}<span>Ключ к модели не обязателен. Без него бот
  работает в режиме без модели и не стоит ничего, кроме аренды сервера. Дописать ключ и перезапустить
  можно в любой момент — переустанавливать ничего не нужно.</span></p>
  </div></section>`
}

function startSection() {
  return `<section class="sec sec--alt" id="start"><div class="wrap narrow">
  <h2 class="rise">Запуск</h2>
  <p class="intro rise">Нужен Node.js 22 или новее. Всё остальное ставится одной командой.</p>

  <pre class="rise"><code>git clone ${REPO}.git
cd seo-revizor
npm install
npm run check meta https://example.com/</code></pre>

  <p class="rise">Конфигурационный файл <code>.mcp.json</code> включён в репозиторий
  по умолчанию. Для старта аудита достаточно трёх шагов:</p>

  <ol class="steps rise">
    <li>Откройте рабочую папку проекта в Claude Code или другом клиенте с поддержкой
    протокола MCP.</li>
    <li>Убедитесь, что инструменты Ревизора появились в списке доступных.</li>
    <li>Отправьте модели запрос: <code>Следуй инструкциям в AGENT.md и проверь сайт
    [адрес_сайта]</code></li>
  </ol>

  <p class="note rise">${icon('spark', 'note__ico')}<span>При запуске у себя десять инструментов
  из одиннадцати работают сразу. Свой ключ нужен только для измерения скорости: его бесплатно
  выдаёт Google, и он остаётся на вашей машине в файле <code>.env</code>. Без ключа проверка
  не прерывается, а помечает раздел скорости как непроверенный. Через телеграм-бот ключ не
  понадобится: там запрос уходит с сервера, на котором Ревизор уже настроен.</span></p>

  <p class="rise">Описание устройства и разбор каждого файла собраны в
  <a href="${REPO}#readme">README репозитория</a>.</p>
  </div></section>`
}

function footer() {
  const columns = [
    [
      'Разделы',
      [
        ['#about', 'О проблеме'],
        ['#tools', 'Инструменты сервера'],
        ['#order', 'Цикл агента'],
        ['#checklist', 'Чек-листы аудита'],
        ['#rules', 'База правил'],
        ['#glossary', 'Глоссарий'],
        ['#bot', 'Телеграм-бот'],
      ],
    ],
    [
      'Репозиторий',
      [
        [REPO, 'Исходный код'],
        [`${REPO}#readme`, 'README: устройство'],
        [`${REPO}/blob/main/AGENT.md`, 'AGENT.md: задание агенту'],
        [`${REPO}/tree/main/src/rules`, 'Правила в файлах данных'],
        [`${REPO}/blob/main/LICENSE`, 'Лицензия MIT'],
        [BOT_URL, 'Бот в телеграме'],
      ],
    ],
  ]

  const links = columns
    .map(
      ([title, items]) => `<div class="foot__col">
      <h3>${esc(title)}</h3>
      <ul>${items.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}</ul>
    </div>`,
    )
    .join('')

  const numbers = [
    [TOOLS.length, 'инструментов'],
    [rules.length, 'правил'],
    [checks.length, 'пунктов аудита'],
    [automated, 'автопроверок'],
    [terms.length, 'терминов'],
  ]
    .map(([value, label]) => `<div><b>${value}</b><span>${esc(label)}</span></div>`)
    .join('')

  return `<footer class="foot">
  <div class="wrap foot__grid">
    <div class="foot__about">
      <p class="foot__big">${icon('security')} SEO-ревизор</p>
      <p>MCP-сервер и агент для технического аудита сайта. Открытый код под лицензией MIT,
      Node.js 22 и новее, четыре зависимости.</p>
      <p class="foot__link">${icon('github')} <a href="${REPO}">github.com/qa-novchenkova/seo-revizor</a></p>
    </div>
    ${links}
    <div class="foot__col foot__nums">
      <h3>В цифрах</h3>
      <div class="foot__numgrid">${numbers}</div>
    </div>
  </div>
  <div class="wrap">
    <p class="foot__note">Страница собрана из файлов проекта: инструменты — из списка,
    который сервер отдаёт клиенту, правила — из чек-листа, порядок — из инструкции агенту.
    Пересобирается при каждом изменении кода, поэтому разойтись с ним не может.</p>
  </div>
</footer>`
}

/** Кнопка возврата наверх — появляется, когда прокрутили заметно вниз. */
function toTop() {
  return `<button type="button" class="totop" aria-label="Наверх">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>
  </svg>
</button>`
}

// ── поведение ────────────────────────────────────────────────────────────────

function script() {
  return `
var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Вкладки: из набора блоков показан ровно один.
// Так устроены и чек-листы, и глоссарий — иначе оба раздела растягивают
// страницу на десятки экранов.
function tabbed(stripId, containerSelector) {
  var strip = document.getElementById(stripId);
  var container = document.querySelector(containerSelector);
  if (!strip || !container) return null;

  var tabs = [].slice.call(strip.querySelectorAll('.chip'));
  var blocks = [].slice.call(container.children);

  function open(id) {
    container.dataset.view = 'tab';
    blocks.forEach(function (block) { block.classList.toggle('open', block.id === id); });
    tabs.forEach(function (tab) { tab.classList.toggle('on', tab.getAttribute('href') === '#' + id); });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function (event) {
      event.preventDefault();
      open(tab.getAttribute('href').slice(1));
    });
  });

  return { open: open, tabs: tabs, container: container };
}

var checklistTabs = tabbed('checklist-tabs', '.lists');
var glossaryTabs = tabbed('gloss-tabs', '.glosses');

// Отбор по способу проверки есть только у чек-листа. Это второй взгляд на тот же
// список, поэтому вкладка и режим не могут быть включены одновременно.
if (checklistTabs) {
  var modes = [].slice.call(document.querySelectorAll('.filters button'));

  modes.forEach(function (button) {
    button.addEventListener('click', function () {
      checklistTabs.container.dataset.view = button.dataset.filter;
      modes.forEach(function (other) { other.classList.toggle('on', other === button); });
      checklistTabs.tabs.forEach(function (tab) { tab.classList.remove('on'); });
    });
  });

  checklistTabs.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      modes.forEach(function (other) { other.classList.remove('on'); });
    });
  });
}

// Ссылка вида #cl-security или #gl-speed извне должна открывать нужную вкладку.
// Слушаем и смену адреса: якорь может появиться уже после загрузки.
function openFromHash() {
  var id = location.hash.slice(1);
  if (!id || !document.getElementById(id)) return;
  if (id.indexOf('cl-') === 0 && checklistTabs) checklistTabs.open(id);
  if (id.indexOf('gl-') === 0 && glossaryTabs) glossaryTabs.open(id);
}

openFromHash();
window.addEventListener('hashchange', openFromHash);

// Появление блоков при прокрутке
var risers = document.querySelectorAll('.rise');
if (calm || !('IntersectionObserver' in window)) {
  risers.forEach(function (node) { node.classList.add('in'); });
} else {
  var watcher = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      watcher.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -60px 0px' });
  risers.forEach(function (node) { watcher.observe(node); });
}

// Счётчики в шапке. В разметке уже стоит настоящее число — если скрипт
// не отработает, посетитель увидит его, а не ноль.
document.querySelectorAll('.num').forEach(function (node) {
  var target = Number(node.dataset.count);
  if (calm) return;

  node.textContent = '0';
  var started = null;
  var span = 1100;
  function tick(now) {
    if (started === null) started = now;
    var part = Math.min((now - started) / span, 1);
    node.textContent = Math.round(target * (1 - Math.pow(1 - part, 3)));
    if (part < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});

// Бургер на узком экране
var nav = document.querySelector('.nav');
var burger = document.querySelector('.nav__burger');

if (nav && burger) {
  var setMenu = function (open) {
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  burger.addEventListener('click', function () {
    setMenu(!nav.classList.contains('open'));
  });

  // Перешли по пункту — меню закрывается, иначе оно закрывает собой цель
  nav.querySelectorAll('.nav__links a').forEach(function (link) {
    link.addEventListener('click', function () { setMenu(false); });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setMenu(false);
  });
}

// Подсветка раздела, в котором сейчас находимся
var links = [].slice.call(document.querySelectorAll('.nav__links a'));
var spots = links
  .map(function (link) { return document.querySelector(link.getAttribute('href')); })
  .filter(Boolean);

if (spots.length && 'IntersectionObserver' in window) {
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      links.forEach(function (link) {
        link.classList.toggle('here', link.getAttribute('href') === '#' + entry.target.id);
      });
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  spots.forEach(function (spot) { spy.observe(spot); });
}

// Кнопка «наверх» и логотип.
// Имя переменной намеренно не top: в браузере top — это само окно,
// и объявление его перезаписать не может.
var upButton = document.querySelector('.totop');
var mark = document.querySelector('.nav__mark');

function toStart(event) {
  if (event) event.preventDefault();
  window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
}

if (mark) mark.addEventListener('click', toStart);

if (upButton) {
  upButton.addEventListener('click', function () { toStart(); });

  var toggleUp = function () { upButton.classList.toggle('shown', window.scrollY > 700); };
  toggleUp();
  window.addEventListener('scroll', toggleUp, { passive: true });
}

// Тем, кто просил не двигать картинки, останавливаем и рисованную анимацию
if (calm) {
  document.querySelectorAll('svg').forEach(function (svg) {
    if (svg.pauseAnimations) svg.pauseAnimations();
  });
}`
}

// ── стили ────────────────────────────────────────────────────────────────────

function style() {
  return `
:root {
  --paper: #F4F6F5; --surface: #FFFFFF; --raise: #FBFCFC; --deep: #0A1614;
  --ink: #101715; --ink-soft: #414D4A; --ink-mute: #58645F;
  --line: #DCE4E1; --line-hard: #BDCAC6;
  --accent: #0F7A72; --accent-ink: #0B564F; --accent-soft: #DFF0ED;
  --hot: #D4443C; --sun: #E08A00; --sky: #1D63D2; --grape: #6D28D9;
  --crit: #B01F24; --warn: #8A6106; --ok: #1E7346;
  --f-head: 'Unbounded', 'Trebuchet MS', sans-serif;
  --f-body: 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif;
  --f-mono: 'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace;
  --rise: 22px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0B1211; --surface: #121A19; --raise: #172221; --deep: #050B0A;
    --ink: #E9F0EE; --ink-soft: #AFBCB8; --ink-mute: #919E9A;
    --line: #22302D; --line: #22302D; --line-hard: #35443F;
    --accent: #4FD1C3; --accent-ink: #8FE5DA; --accent-soft: #10312D;
    --hot: #FF8A80; --sun: #F5B740; --sky: #7FB0FF; --grape: #BFA0FF;
    --crit: #FF9B9B; --warn: #F0C25A; --ok: #74D8A0;
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: var(--f-body); font-size: 16.5px; line-height: 1.66;
  -webkit-font-smoothing: antialiased; overflow-x: hidden;
}
a { color: var(--accent-ink); }
:focus-visible { outline: 2.5px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
h1, h2, h3, h4 { font-family: var(--f-head); letter-spacing: -.02em; text-wrap: balance; }
b { font-weight: 600; }

.wrap { max-width: 1320px; margin: 0 auto; padding: 0 24px; }
.wrap.narrow { max-width: 760px; }

.ico { width: 1.25em; height: 1.25em; flex: none; }

/* Появление при прокрутке. Прячем только когда скрипты работают —
   иначе без них страница осталась бы пустой. */
.js .rise { opacity: 0; transform: translateY(var(--rise)); transition: opacity .6s ease, transform .6s cubic-bezier(.2,.7,.3,1); transition-delay: var(--wait, 0ms); }
.js .rise.in { opacity: 1; transform: none; }

/* ---------- шапка ---------- */
.hero {
  position: relative; overflow: hidden;
  background: var(--deep); color: #EAF4F2;
  padding: 74px 0 0;
}
.hero__glow {
  position: absolute; border-radius: 50%; filter: blur(70px);
  opacity: .55; pointer-events: none;
}
.hero__glow--a { width: 460px; height: 460px; background: #0F7A72; top: -170px; left: -120px; animation: drift 17s ease-in-out infinite; }
.hero__glow--b { width: 380px; height: 380px; background: #6D28D9; top: 40px; right: -130px; opacity: .4; animation: drift 21s ease-in-out infinite reverse; }
.hero__glow--c { width: 320px; height: 320px; background: #D4443C; bottom: -160px; left: 42%; opacity: .3; animation: drift 25s ease-in-out infinite; }
@keyframes drift {
  0%, 100% { transform: translate3d(0,0,0) scale(1); }
  50% { transform: translate3d(26px, -22px, 0) scale(1.12); }
}

.hero__in { position: relative; display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 56px; align-items: center; }
@media (max-width: 900px) { .hero__in { grid-template-columns: 1fr; } .scan { display: none; } }

.kicker {
  display: inline-flex; align-items: center; gap: 8px; margin: 0 0 18px;
  font-family: var(--f-mono); font-size: .7rem; font-weight: 600;
  letter-spacing: .13em; text-transform: uppercase; color: #6FE0D2;
  border: 1px solid #1D4A45; border-radius: 999px; padding: 6px 14px;
}
.hero h1 {
  margin: 0; font-size: clamp(2.9rem, 8.4vw, 5.4rem); line-height: .94;
  font-weight: 800; letter-spacing: -.045em;
}
.hero h1 em {
  font-style: normal;
  background: linear-gradient(96deg, #4FD1C3, #7FB0FF 46%, #FF8A80);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.lede { margin: 22px 0 0; font-size: 1.14rem; max-width: 56ch; color: #C6D6D3; }
.lede b { color: #EAF4F2; }
.lede__line { display: block; margin-top: 8px; font-weight: 600; letter-spacing: .01em; }

.cta { display: flex; flex-wrap: wrap; gap: 12px; margin: 32px 0 0; }
.btn {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 13px 24px; border-radius: 11px; text-decoration: none;
  font-weight: 600; font-size: .96rem;
  transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
}
.btn--main { background: #4FD1C3; color: #05201D; box-shadow: 0 8px 26px -12px #4FD1C3; }
.btn--main:hover { transform: translateY(-2px); box-shadow: 0 14px 32px -12px #4FD1C3; }
.btn--ghost { border: 1px solid #27524C; color: #BFE4DF; }
.btn--ghost:hover { background: #10302C; transform: translateY(-2px); }
/* Тот же вид кнопки на светлом разделе: цвета шапки там не читаются. */
.sec .btn--ghost { border-color: var(--line-hard); color: var(--ink); }
.sec .btn--ghost:hover { background: var(--accent-soft); border-color: var(--accent); }

/* картинка со сканированием */
.scan svg { width: 100%; height: auto; display: block; }
.scan__frame { fill: #0D201E; stroke: #23423E; stroke-width: 1.6; }
.scan__bar { stroke: #23423E; stroke-width: 1.6; }
.scan__url { fill: #16332F; }
.scan__dot--r { fill: #FF8A80; } .scan__dot--y { fill: #F5B740; } .scan__dot--g { fill: #4FD1C3; }
.scan__line { fill: #1B3B37; animation: lineOn 3.6s ease-in-out infinite; }
@keyframes lineOn { 0%, 12% { fill: #1B3B37; } 26%, 74% { fill: #2E605A; } 92%, 100% { fill: #1B3B37; } }
.scan__ok { opacity: 0; animation: okOn 3.6s ease-in-out infinite; }
.scan__ok circle { fill: none; stroke: #4FD1C3; stroke-width: 1.5; }
.scan__ok path { fill: none; stroke: #4FD1C3; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
@keyframes okOn { 0%, 14% { opacity: 0; transform: scale(.7); } 30%, 78% { opacity: 1; transform: scale(1); } 94%, 100% { opacity: 0; } }
.scan__ok { transform-origin: 228px 100px; }
.scan__beam { animation: sweep 3.6s cubic-bezier(.5,0,.5,1) infinite; }
.scan__beam rect:first-child { fill: #4FD1C3; }
.scan__haze { fill: url(#none); fill: #4FD1C3; opacity: .12; }
@keyframes sweep {
  0% { transform: translateY(46px); opacity: 0; }
  8% { opacity: 1; }
  86% { opacity: 1; }
  100% { transform: translateY(268px); opacity: 0; }
}

/* цифры */
.facts {
  position: relative; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px; margin: 52px auto 0; padding-bottom: 46px;
}
.fact {
  border: 1px solid #1C3B37; border-radius: 14px; padding: 16px 18px;
  background: linear-gradient(160deg, #0F211F, #0A1614);
}
.fact__ico { color: #4FD1C3; width: 22px; height: 22px; }
.fact dd {
  margin: 8px 0 0; font-family: var(--f-head); font-weight: 800;
  font-size: 2.1rem; line-height: 1; color: #EAF4F2; font-variant-numeric: tabular-nums;
}
.fact dt {
  margin: 7px 0 0; font-family: var(--f-mono); font-size: .64rem; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: #8FA8A4;
}

/* ---------- бегущая строка ---------- */
.ticker {
  background: var(--accent-soft); border-block: 1px solid var(--line);
  overflow: hidden; padding: 11px 0;
}
.ticker__row { display: flex; gap: 30px; width: max-content; animation: run 130s linear infinite; }
.ticker:hover .ticker__row { animation-play-state: paused; }
@keyframes run { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.tick {
  display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
  font-size: .84rem; color: var(--accent-ink); font-weight: 500;
}
.tick__ico { width: 15px; height: 15px; color: var(--accent); }

/* ---------- меню ---------- */
.nav {
  position: sticky; top: 0; z-index: 6;
  background: var(--deep); color: #D6E7E4;
  border-bottom: 1px solid #1C3B37;
  box-shadow: 0 6px 20px -14px #000A;
}
.nav .wrap { display: flex; align-items: center; gap: 20px; overflow-x: auto; }
.nav__mark {
  display: inline-flex; align-items: center; gap: 8px; flex: none;
  font-family: var(--f-head); font-weight: 600; font-size: .93rem; color: #EAF4F2;
  padding: 13px 0; letter-spacing: -.01em; text-decoration: none;
}
.nav__mark:hover { color: #FFF; }
.nav__mark:hover .ico { color: #7FE3D7; }
.nav__mark .ico { width: 19px; height: 19px; color: #4FD1C3; transition: color .15s ease; }
/* Отрицательный отступ справа равен внутреннему отступу пункта: так последняя
   буква меню встаёт ровно по границе колонки содержимого. */
.nav__links { display: flex; gap: 4px; margin-left: auto; margin-right: -14px; }
.nav a {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 14px; margin: 8px 0; border-radius: 9px;
  font-size: .87rem; text-decoration: none; font-weight: 500;
  color: #A9C4C0; white-space: nowrap;
  transition: color .15s ease, background .15s ease;
}
.nav a .ico { width: 16px; height: 16px; opacity: .8; }
.nav a:hover { color: #EAF4F2; background: #14312D; }
.nav a.here { color: #06211E; background: #4FD1C3; }
.nav a.here .ico { opacity: 1; }

/* Бургер. Показывается только на узком экране и только при работающих
   скриптах: без них меню остаётся обычным списком ссылок. */
.nav__burger {
  display: none; margin-left: auto; padding: 9px; cursor: pointer;
  background: none; border: 1px solid #27524C; border-radius: 9px; color: #D6E7E4;
}
/* Показ иконок задаётся на том же уровне вложенности, что и размер:
   иначе «.nav__burger .ico» перебивает «display: none» и рисуются обе. */
.nav__burger .ico { width: 20px; height: 20px; }
.nav__burger .nav__burger-open { display: block; }
.nav__burger .nav__burger-close { display: none; }
.nav.open .nav__burger .nav__burger-open { display: none; }
.nav.open .nav__burger .nav__burger-close { display: block; }

@media (max-width: 760px) {
  .nav .wrap { overflow: visible; gap: 12px; }
  .nav__links { margin-right: 0; }
  .js .nav__burger { display: block; }
  .js .nav__links {
    position: absolute; left: 0; right: 0; top: 100%;
    display: none; flex-direction: column; gap: 3px;
    padding: 10px 16px 16px; background: var(--deep);
    border-bottom: 1px solid #1C3B37; box-shadow: 0 16px 30px -18px #000C;
  }
  .js .nav.open .nav__links { display: flex; }
  .nav a { margin: 0; padding: 11px 13px; }
}

/* ---------- кнопки-переходы по разделам ---------- */
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 26px; }
.chip {
  --hue: var(--tone);
  display: inline-flex; align-items: center; gap: 8px; text-decoration: none;
  padding: 8px 14px; border-radius: 999px; font-size: .85rem; font-weight: 500;
  color: var(--ink); border: 1px solid color-mix(in srgb, var(--hue) 42%, transparent);
  background: color-mix(in srgb, var(--hue) 8%, transparent);
  transition: background .16s ease, transform .16s ease, border-color .16s ease;
}
@media (prefers-color-scheme: dark) { .chip { --hue: var(--tone-dark); } }
.chip:hover {
  background: color-mix(in srgb, var(--hue) 15%, transparent);
  border-color: var(--hue); transform: translateY(-2px);
}
/* Цветом раздела красится только значок и рамка: как текст эти краски
   не набирают нужного контраста на светлой подложке. */
.chip .ico { width: 17px; height: 17px; color: var(--hue); }
.chip b {
  font-family: var(--f-mono); font-size: .7rem; font-weight: 600;
  color: var(--ink-soft);
}
.chip--plain { --tone: var(--accent); --tone-dark: var(--accent); }

/* Выбранная вкладка */
.chip.on { background: var(--hue); border-color: var(--hue); color: #FFF; }
.chip.on b { color: #FFF; opacity: .85; }
.chip.on:hover { background: var(--hue); }
@media (prefers-color-scheme: dark) {
  .chip.on { color: #0B1211; }
  .chip.on b { color: #0B1211; }
}
.tabs { gap: 8px; margin-bottom: 18px; }
/* На узком экране десять вкладок встают в десять строк и съедают пол-экрана,
   поэтому там они превращаются в прокручиваемую ленту. */
@media (max-width: 700px) {
  .tabs {
    flex-wrap: nowrap; overflow-x: auto; padding-bottom: 8px;
    scroll-snap-type: x proximity; scrollbar-width: thin;
  }
  .tabs .chip { flex: none; scroll-snap-align: start; }
}

.filters__label {
  align-self: center; margin-right: 4px;
  font-family: var(--f-mono); font-size: .68rem; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: var(--ink-mute);
}

/* ---------- разделы ---------- */
.sec { padding: 74px 0; scroll-margin-top: 54px; }
.sec--alt { background: var(--surface); border-block: 1px solid var(--line); }
.sec h2 {
  margin: 0 0 18px; font-size: clamp(1.85rem, 4vw, 2.6rem); font-weight: 800;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.badge {
  font-family: var(--f-mono); font-size: .78rem; font-weight: 600;
  background: var(--accent); color: #FFF; padding: 4px 11px; border-radius: 999px;
  letter-spacing: .04em;
}
@media (prefers-color-scheme: dark) { .badge { color: #05201D; } }
.sub { margin: 52px 0 16px; font-size: 1.36rem; font-weight: 600; }
.intro { margin: 0 0 30px; color: var(--ink-soft); max-width: 66ch; }
.intro--wide, .sec p.intro--wide { max-width: none; }
.sec p { max-width: 68ch; }

/* Флекс раскладывает по колонке каждого прямого потомка, поэтому текст
   заметки лежит в одном span: иначе <code> внутри становится отдельной
   колонкой и разрывает абзац. */
.note {
  display: flex; gap: 12px; align-items: flex-start;
  background: var(--accent-soft); border-radius: 12px; padding: 16px 18px;
  color: var(--accent-ink); font-size: .94rem; margin-top: 26px;
}
.note__ico { color: var(--accent); margin-top: 3px; }
.note > span { flex: 1; min-width: 0; }
.note code {
  font-family: var(--f-mono); font-size: .86em;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  padding: 1px 6px; border-radius: 5px;
}

/* ---------- карточки ---------- */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(258px, 1fr)); gap: 16px; }
.card {
  background: var(--raise); border: 1px solid var(--line); border-radius: 16px; padding: 24px;
  transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
}
.card:hover { transform: translateY(-4px); border-color: var(--accent); box-shadow: 0 16px 34px -22px var(--accent); }
.card__ico {
  display: inline-flex; padding: 11px; border-radius: 12px;
  background: var(--accent-soft); color: var(--accent-ink); margin-bottom: 14px;
}
.card__ico .ico { width: 24px; height: 24px; }
.card h3 { margin: 0 0 8px; font-size: 1.18rem; font-weight: 600; }
.card p { margin: 0; font-size: .93rem; color: var(--ink-soft); }

/* ---------- инструменты ---------- */
.tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.tool {
  position: relative; overflow: hidden;
  background: var(--raise); border: 1px solid var(--line); border-radius: 15px; padding: 22px;
  transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
}
.tool::after {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--sky));
  transform: scaleX(0); transform-origin: left; transition: transform .3s ease;
}
.tool:hover { transform: translateY(-4px); border-color: var(--line-hard); box-shadow: 0 18px 36px -24px #0006; }
.tool:hover::after { transform: scaleX(1); }
.tool__ico {
  display: inline-flex; padding: 10px; border-radius: 11px;
  background: var(--accent-soft); color: var(--accent-ink); margin-bottom: 13px;
}
.tool__ico .ico { width: 22px; height: 22px; }
.tool h3 { margin: 0; font-size: 1.06rem; font-weight: 600; }
.tool code {
  display: inline-block; margin: 8px 0 11px; font-family: var(--f-mono);
  font-size: .73rem; color: var(--accent-ink); background: var(--accent-soft);
  padding: 3px 8px; border-radius: 6px;
}
.tool p { margin: 0; font-size: .9rem; color: var(--ink-soft); }
.tool__row { margin: 0 0 14px; }
.tool__row + .tool__row {
  margin-bottom: 0; padding-top: 14px; border-top: 1px solid var(--line);
}
.tool__row span {
  display: block; font-family: var(--f-mono); font-size: .62rem; font-weight: 600;
  letter-spacing: .11em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 3px;
}

/* ---------- список шагов ---------- */
.beats { margin: 0 0 26px; padding: 0; list-style: none; display: grid; gap: 10px; max-width: 66ch; }
.beats--wide { max-width: none; }
.beats b { color: var(--ink); }
.beats li {
  position: relative; padding-left: 30px; color: var(--ink-soft); font-size: .95rem;
}
.beats li::before {
  content: ''; position: absolute; left: 8px; top: .62em;
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
}

/* ---------- схема цикла ---------- */
.loop {
  background: var(--raise); border: 1px solid var(--line); border-radius: 16px;
  padding: 20px 16px; overflow-x: auto; margin-bottom: 10px;
}
/* Показ схемы задаётся только на самих классах: если оставить display
   на «.loop svg», это правило окажется специфичнее и переключение сломается. */
.loop svg { width: 100%; height: auto; color: var(--line-hard); }
.loop__wide { display: block; min-width: 760px; }
.loop__tall { display: none; }
/* На узком экране широкая схема нечитаема, поэтому показывается та же
   последовательность, собранная столбиком. */
@media (max-width: 760px) {
  .loop { overflow-x: visible; padding: 16px 12px; }
  .loop__wide { display: none; }
  .loop__tall { display: block; max-width: 340px; margin: 0 auto; }
}
.loop__zone { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 6 5; opacity: .55; }
.loop__zonelabel {
  font-family: var(--f-mono); font-size: 10.5px; font-weight: 600;
  letter-spacing: .16em; text-transform: uppercase; fill: var(--accent-ink);
}
.loop__node rect { fill: var(--surface); stroke: var(--line-hard); stroke-width: 1.4; }
.loop__node--enter rect { stroke: var(--ink-mute); stroke-dasharray: 5 4; }
.loop__node--out rect { fill: var(--accent); stroke: var(--accent); }
.loop__node--out .loop__t { fill: #FFF; }
@media (prefers-color-scheme: dark) { .loop__node--out .loop__t { fill: #05201D; } }
.loop__t { font-family: var(--f-body); font-size: 15px; font-weight: 600; fill: var(--ink); text-anchor: middle; }
.loop__n { font-family: var(--f-mono); font-size: 11px; font-weight: 600; fill: var(--accent-ink); }
.loop__s { font-family: var(--f-body); font-size: 11.5px; fill: var(--ink-mute); text-anchor: middle; }
.loop__wire path { stroke: var(--accent); stroke-width: 1.8; color: var(--accent); }
.loop__wire--out path { stroke: var(--ink-mute); color: var(--ink-mute); stroke-dasharray: 5 4; }
.loop__spark { fill: var(--accent); }
.loop__note { font-family: var(--f-mono); font-size: 11px; fill: var(--ink-mute); text-anchor: middle; }

/* ---------- порядок ---------- */
/* Два столбца на просторном экране, один на узком. Сетка заполняется
   построчно, поэтому нумерация читается слева направо. */
.order {
  margin: 0; padding: 0; list-style: none; counter-reset: s;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;
}
@media (max-width: 760px) { .order { grid-template-columns: 1fr; } }
.order li {
  counter-increment: s; position: relative;
  padding: 18px 20px 18px 64px; color: var(--ink-soft); font-size: .95rem;
  background: var(--raise); border: 1px solid var(--line); border-radius: 14px;
  transition: transform .2s ease, border-color .2s ease;
}
.order li:hover { transform: translateY(-3px); border-color: var(--line-hard); }
.order li::before {
  content: counter(s, decimal-leading-zero); position: absolute; left: 20px; top: 19px;
  width: 30px; height: 26px; display: grid; place-items: center;
  font-family: var(--f-mono); font-size: .7rem; font-weight: 600;
  color: var(--accent-ink); background: var(--accent-soft); border-radius: 7px;
}
.order h4 {
  margin: 0 0 6px; font-size: 1.05rem; font-weight: 600; color: var(--ink);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.order p { margin: 0; }
.order code {
  font-family: var(--f-mono); font-size: .72rem; font-weight: 400;
  color: var(--accent-ink); background: var(--accent-soft); padding: 2px 7px; border-radius: 5px;
}

/* ---------- чек-листы ---------- */
.legend { margin: 0 0 24px; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 9px 22px; }
.legend li { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--ink-soft); }

.filters { display: flex; flex-wrap: wrap; gap: 9px; margin: 0 0 30px; }
.filters button {
  display: inline-flex; align-items: center; gap: 8px;
  font: inherit; font-size: .88rem; cursor: pointer;
  padding: 10px 18px; border-radius: 10px;
  border: 1px solid var(--line-hard); background: var(--raise); color: var(--ink-soft);
  transition: border-color .18s ease, transform .18s ease, background .18s ease;
}
.filters button .ico { width: 17px; height: 17px; }
.filters button:hover { border-color: var(--accent); transform: translateY(-2px); }
.filters button.on { background: var(--accent); border-color: var(--accent); color: #FFF; }
@media (prefers-color-scheme: dark) { .filters button.on { color: #05201D; } }

.block { --hue: var(--tone); margin: 0 0 46px; }
@media (prefers-color-scheme: dark) { .block { --hue: var(--tone-dark); } }

.block__head { display: flex; gap: 15px; align-items: flex-start; margin-bottom: 14px; }
.block__ico {
  display: inline-flex; padding: 11px; border-radius: 13px; flex: none;
  color: var(--hue); background: color-mix(in srgb, var(--hue) 13%, transparent);
}
.block__ico .ico { width: 24px; height: 24px; }
.block__title { min-width: 0; }
.block h3 { margin: 0 0 5px; font-size: 1.34rem; font-weight: 600; }
.block h3 .count {
  font-family: var(--f-mono); font-size: .68rem; font-weight: 600;
  color: #FFF; background: var(--hue); padding: 3px 8px; border-radius: 999px;
  vertical-align: middle; margin-left: 7px;
}
@media (prefers-color-scheme: dark) { .block h3 .count { color: #0B1211; } }
.block__intro { margin: 0; color: var(--ink-soft); font-size: .92rem; max-width: 66ch; }

.barline { display: flex; align-items: center; gap: 12px; margin-bottom: 15px; }
.bar {
  position: relative; flex: 1 1 auto; max-width: 320px; height: 10px;
  border-radius: 6px; overflow: hidden;
  background: color-mix(in srgb, var(--hue) 16%, transparent);
}
.bar__fill {
  position: absolute; inset: 0 auto 0 0; width: var(--share); border-radius: 6px;
  background: var(--hue);
  transform-origin: left; transition: transform .9s cubic-bezier(.2,.7,.3,1) .15s;
}
/* Полоса наполняется при появлении блока. Без скриптов она просто сразу полная. */
.js .rise:not(.in) .bar__fill { transform: scaleX(0); }
.bar__text {
  flex: none; font-family: var(--f-mono); font-size: .7rem;
  color: var(--ink-soft); letter-spacing: .03em;
}
.bar__text b { color: var(--ink); font-weight: 600; }

.checks { margin: 0; padding: 0; list-style: none; counter-reset: c; }
.chk {
  counter-increment: c; position: relative;
  background: var(--raise); border: 1px solid var(--line);
  padding: 16px 18px 16px 50px;
  transition: background .15s ease;
}
.chk:hover { background: color-mix(in srgb, var(--hue) 5%, var(--raise)); }
.chk:first-child { border-radius: 12px 12px 0 0; }
.chk:last-child { border-radius: 0 0 12px 12px; }
.chk + .chk { border-top: none; }
.chk::before {
  content: counter(c, decimal-leading-zero); position: absolute; left: 17px; top: 18px;
  font-family: var(--f-mono); font-size: .7rem; font-weight: 600; color: var(--hue);
  font-variant-numeric: tabular-nums;
}
.chk__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.chk__head h4 { margin: 0; font-size: 1.02rem; font-weight: 600; }
.chk__why { margin: 6px 0 0; font-size: .92rem; color: var(--ink-soft); }
.chk__how {
  margin: 10px 0 0; font-size: .87rem; color: var(--ink-soft);
  border-left: 2px solid var(--hue); padding-left: 13px;
}
.chk__how span {
  display: block; font-family: var(--f-mono); font-size: .63rem; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 2px;
}

.tag {
  flex: none; font-family: var(--f-mono); font-size: .62rem; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 9px; border-radius: 6px; white-space: nowrap;
  border: 1px solid currentColor;
}
.tag--auto { color: var(--ok); }
.tag--both { color: var(--accent-ink); }
.tag--manual { color: var(--warn); }
.tag--service { color: var(--sky); }

/* Вкладки: открыт один раздел. Прячем только при работающих скриптах —
   без них показываются все разделы подряд, и ссылки-якоря работают как обычно. */
.js .lists[data-view="tab"] .block:not(.open) { display: none; }
.js .glosses[data-view="tab"] .gloss:not(.open) { display: none; }

.lists[data-view="machine"] .chk[data-side="human"],
.lists[data-view="human"] .chk[data-side="machine"] { display: none; }
.lists[data-view="machine"] .block[data-machine="0"],
.lists[data-view="human"] .block[data-human="0"] { display: none; }
.lists[data-view="machine"] .chk[data-side="machine"]:first-of-type,
.lists[data-view="human"] .chk[data-side="human"]:first-of-type { border-radius: 12px 12px 0 0; }
.lists[data-view="machine"] .chk[data-side="machine"]:last-of-type,
.lists[data-view="human"] .chk[data-side="human"]:last-of-type { border-radius: 0 0 12px 12px; }
.lists[data-view="machine"] .barline, .lists[data-view="human"] .barline { display: none; }

/* ---------- правила ---------- */
.sevs { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 13px; margin-bottom: 30px; }
.sevcard {
  border: 1px solid var(--line); border-left: 4px solid currentColor;
  border-radius: 13px; padding: 17px 19px; background: var(--raise);
}
.sevcard--critical { color: var(--crit); }
.sevcard--important { color: var(--warn); }
.sevcard--minor { color: var(--ink-mute); }
.sevcard__num { display: block; font-family: var(--f-head); font-weight: 800; font-size: 2rem; line-height: 1; }
.sevcard__label {
  display: block; margin-top: 7px; font-family: var(--f-mono); font-size: .66rem;
  font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-mute);
}

.rulebars { margin: 0; padding: 0; list-style: none; }
.rulebars li {
  display: grid; grid-template-columns: minmax(0, 1fr) 130px 40px; gap: 14px;
  align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line);
  font-size: .91rem; color: var(--ink-soft);
}
.rule__bar { height: 8px; border-radius: 5px; background: var(--accent-soft); overflow: hidden; }
.rule__bar i { display: block; height: 100%; width: var(--w); background: var(--accent); border-radius: 5px; }
.rule__num { text-align: right; font-family: var(--f-mono); font-variant-numeric: tabular-nums; color: var(--ink); }
@media (max-width: 560px) { .rulebars li { grid-template-columns: minmax(0,1fr) 46px; } .rule__bar { display: none; } }

.findings { display: grid; gap: 13px; }
.finding {
  background: var(--raise); border: 1px solid var(--line);
  border-left: 4px solid var(--line-hard); border-radius: 13px; padding: 19px 21px;
}
.finding--critical { border-left-color: var(--crit); }
.finding--important { border-left-color: var(--warn); }
.finding--minor { border-left-color: var(--ink-mute); }
.finding__head { display: flex; align-items: baseline; gap: 11px; flex-wrap: wrap; }
.finding__head h4 { margin: 0; font-size: 1.06rem; font-weight: 600; }
.sev { font-family: var(--f-mono); font-size: .62rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
.finding--critical .sev { color: var(--crit); }
.finding--important .sev { color: var(--warn); }
.finding--minor .sev { color: var(--ink-mute); }
.finding__msg { margin: 9px 0 0; font-size: .95rem; }
.finding__row { margin: 9px 0 0; font-size: .89rem; color: var(--ink-soft); }
.finding__row span {
  display: block; font-family: var(--f-mono); font-size: .62rem; font-weight: 600;
  letter-spacing: .11em; text-transform: uppercase; color: var(--ink-mute);
}

/* ---------- глоссарий ---------- */
.glosses { display: grid; gap: 34px; }
.gloss h3 { margin: 0 0 5px; font-size: 1.3rem; font-weight: 600; }
.count--plain {
  font-family: var(--f-mono); font-size: .68rem; font-weight: 600; color: var(--ink-mute);
  background: none; padding: 0; margin-left: 6px; vertical-align: middle;
}
.gloss__intro { margin: 0 0 16px; color: var(--ink-soft); font-size: .92rem; }
.gloss__list {
  margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px;
}
.gloss__item {
  background: var(--raise); border: 1px solid var(--line); border-radius: 13px;
  padding: 17px 19px; border-left: 3px solid var(--accent);
  transition: border-color .16s ease, transform .16s ease;
}
.gloss__item:hover { transform: translateY(-3px); border-left-color: var(--sky); }
.gloss__item dt { font-family: var(--f-head); font-size: 1rem; font-weight: 600; }
.gloss__full {
  display: block; font-family: var(--f-mono); font-size: .68rem; font-weight: 400;
  color: var(--ink-mute); letter-spacing: .02em; margin-top: 3px;
}
.gloss__item dd { margin: 9px 0 0; font-size: .9rem; color: var(--ink-soft); }

/* ---------- шаги запуска ---------- */
.steps { margin: 0 0 26px; padding: 0; list-style: none; counter-reset: q; display: grid; gap: 10px; }
.steps li {
  counter-increment: q; position: relative; padding-left: 40px;
  color: var(--ink-soft); font-size: .95rem;
}
.steps li::before {
  content: counter(q); position: absolute; left: 0; top: .1em;
  width: 26px; height: 26px; display: grid; place-items: center;
  font-family: var(--f-mono); font-size: .72rem; font-weight: 600;
  color: #FFF; background: var(--accent); border-radius: 50%;
}
@media (prefers-color-scheme: dark) { .steps li::before { color: #05201D; } }
.steps code {
  font-family: var(--f-mono); font-size: .84em; color: var(--ink);
  background: var(--accent-soft); padding: 2px 7px; border-radius: 5px;
}

/* ---------- телеграм-бот ---------- */
.botgrid { display: grid; grid-template-columns: minmax(0, 400px) minmax(0, 1fr); gap: 40px; align-items: start; margin: 34px 0 10px; }
@media (max-width: 900px) { .botgrid { grid-template-columns: 1fr; gap: 28px; } }

/* Ширину держим: на узком экране картинка иначе растягивается во всю страницу,
   и текст в ней становится крупнее заголовков раздела. */
.chat { max-width: 400px; margin-inline: auto; }
.chat svg { width: 100%; height: auto; display: block; }
.chat text { font-family: var(--f-body); }
.chat__bubble, .chat__file rect:first-child { fill: var(--surface); stroke: var(--line); stroke-width: 1.4; }
.chat__head, .chat__link { font-size: 15px; font-weight: 500; }
.chat__head { fill: var(--ink); }
.chat__link { fill: var(--sky); }
.chat__dot, .chat__name { fill: var(--ink); font-size: 14px; }
.chat__time { fill: var(--ink-mute); font-size: 14px; }
.chat__done { fill: var(--ink); font-size: 14px; font-weight: 600; }
.chat__pages { fill: var(--ink-mute); font-size: 12px; }
.chat__badge { fill: var(--accent-soft); }
.chat__badge-ico { stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; }
.chat__file-name { fill: var(--ink); font-size: 13px; font-weight: 600; }
.chat__file-size { fill: var(--ink-mute); font-size: 11.5px; }

/* Строки появляются одна за другой, но только когда переписка попала на экран:
   иначе она успевает отыграть, пока читатель ещё наверху страницы. */
.js .chat__row, .js .chat__file { opacity: 0; }
.js .chat.in .chat__row, .js .chat.in .chat__file { animation: chatIn .45s ease forwards; animation-delay: var(--at, 0s); }
@keyframes chatIn { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .js .chat__row, .js .chat__file { opacity: 1; }
  .js .chat.in .chat__row, .js .chat.in .chat__file { animation: none; }
}

.keys { display: grid; gap: 10px; margin: 0 0 30px; }
.key { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 4px 12px; align-items: start;
  border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--surface); }
.key__ico { color: var(--accent); grid-row: span 2; margin-top: 2px; }
.key h4 { margin: 0; font-size: .95rem; }
.key p { margin: 0; color: var(--ink-soft); font-size: .88rem; line-height: 1.55; }

.cmds { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.cmds li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font-size: .9rem; }
.cmds code { font-family: var(--f-mono); font-size: .84rem; color: var(--ink);
  background: var(--accent-soft); padding: 2px 8px; border-radius: 5px; }
.cmds span { color: var(--ink-soft); }

.modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 24px 0 26px; }
@media (max-width: 760px) { .modes { grid-template-columns: 1fr; } }
.mode { border: 1px solid var(--line); border-radius: 14px; padding: 20px 22px; background: var(--surface); }
.mode h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: 1.05rem; }
.mode__ico { color: var(--accent); }
.mode p { margin: 0 0 16px; color: var(--ink-soft); font-size: .92rem; line-height: 1.6; }
.mode__facts { display: grid; gap: 8px; margin: 0; padding-top: 14px; border-top: 1px solid var(--line); }
.mode__facts > div { display: flex; justify-content: space-between; gap: 12px; }
.mode__facts dt { color: var(--ink-mute); font-size: .82rem; }
.mode__facts dd { margin: 0; font-weight: 600; font-size: .86rem; text-align: right; }

.tablewrap { overflow-x: auto; margin: 0 0 26px; }
.prices { border-collapse: collapse; width: 100%; min-width: 560px; font-size: .9rem; }
.prices th, .prices td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.prices th { color: var(--ink-mute); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
.prices td { color: var(--ink-soft); }
.prices td b { color: var(--ink); }
.prices .mono { font-family: var(--f-mono); font-size: .84rem; white-space: nowrap; }

/* ---------- наверх ---------- */
.totop {
  position: fixed; right: 22px; bottom: 22px; z-index: 8;
  width: 46px; height: 46px; border-radius: 50%; cursor: pointer;
  border: 1px solid var(--accent); background: var(--accent); color: #FFF;
  display: grid; place-items: center; padding: 0;
  opacity: 0; visibility: hidden; transform: translateY(10px);
  transition: opacity .25s ease, transform .25s ease, visibility .25s;
  box-shadow: 0 10px 26px -12px var(--accent);
}
.totop svg { width: 21px; height: 21px; }
.totop.shown { opacity: 1; visibility: visible; transform: none; }
.totop:hover { transform: translateY(-3px); }
@media (prefers-color-scheme: dark) { .totop { color: #05201D; } }
@media (max-width: 560px) { .totop { right: 14px; bottom: 14px; width: 42px; height: 42px; } }

/* ---------- запуск ---------- */
pre {
  background: var(--deep); color: #D9E9E6; border-radius: 13px;
  padding: 20px 22px; overflow-x: auto; font-size: .87rem; line-height: 1.75;
  border: 1px solid #1C3B37;
}
pre code { font-family: var(--f-mono); }
.sec p code { font-family: var(--f-mono); font-size: .86em; background: var(--accent-soft); color: var(--ink); padding: 2px 6px; border-radius: 5px; }

/* ---------- подвал ---------- */
.foot { background: var(--deep); color: #A7BEBA; padding: 54px 0 34px; font-size: .88rem; }
.foot a { color: #6FE0D2; text-decoration: none; }
.foot a:hover { text-decoration: underline; }
.foot p { margin: 0 0 10px; max-width: 46ch; }

.foot__grid {
  display: grid; grid-template-columns: 1.5fr 1fr 1.2fr 1fr; gap: 34px;
  padding-bottom: 30px; border-bottom: 1px solid #1C3B37; margin-bottom: 22px;
}
@media (max-width: 900px) { .foot__grid { grid-template-columns: 1fr 1fr; gap: 28px; } }
@media (max-width: 560px) { .foot__grid { grid-template-columns: 1fr; } }

.foot__big {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  font-family: var(--f-head); font-size: 1.1rem; font-weight: 600; color: #EAF4F2;
}
.foot__big .ico { width: 22px; height: 22px; color: #4FD1C3; }
.foot__link { display: flex; align-items: center; gap: 9px; margin-top: 14px; }
.foot__link .ico { width: 18px; height: 18px; color: #6FE0D2; }

.foot__col h3 {
  margin: 0 0 12px; font-family: var(--f-mono); font-size: .66rem; font-weight: 600;
  letter-spacing: .13em; text-transform: uppercase; color: #7E938F;
}
.foot__col ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
.foot__col li { font-size: .87rem; }

.foot__numgrid { display: grid; gap: 9px; }
.foot__numgrid div { display: flex; align-items: baseline; gap: 9px; }
.foot__numgrid b {
  font-family: var(--f-head); font-size: 1.12rem; font-weight: 700; color: #EAF4F2;
  min-width: 2.4ch; font-variant-numeric: tabular-nums;
}
.foot__numgrid span { font-size: .82rem; color: #A7BEBA; }

.foot__note { color: #8A9F9B; font-size: .82rem; max-width: 78ch; margin: 0; }

@media (max-width: 560px) {
  body { font-size: 16px; }
  .hero { padding-top: 52px; }
  .sec { padding: 52px 0; }
  .chk { padding: 15px 15px 15px 44px; }
  .chk__head { flex-wrap: wrap; }
  .chk__head h4 { flex: 1 1 100%; }
  .block__head { gap: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .rise { opacity: 1; transform: none; }
  .bar__fill { transform: scaleX(1); }
}`
}

// ── мелочи ───────────────────────────────────────────────────────────────────

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Разметка Markdown внутри строки: только жирный и код, больше в AGENT.md ничего нет. */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function plural(count, forms) {
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 14) return forms[2]
  const mod10 = count % 10
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}
