/**
 * Собирает страницу проекта в docs/index.html.
 *
 * Ничего не придумывает: всё содержимое берётся из тех же файлов,
 * по которым работает сам Ревизор.
 *
 *   инструменты  — из src/server.js, список TOOLS
 *   правила      — из src/rules/*.json
 *   порядок      — из AGENT.md, раздел «Порядок работы»
 *   чек-листы    — из src/checklist/checklist.json
 *
 * Поэтому страница не может разойтись с кодом: поменяли правило —
 * пересобрали страницу, и она уже другая.
 *
 *   npm run site
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOOLS } from '../src/server.js'
import { allRules, rulesByArea, SEVERITY_LABELS } from '../src/rules/index.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REPO = 'https://github.com/qa-novchenkova/seo-revizor'

/** Как называется каждый вид проверки и что он означает. */
const KINDS = {
  auto: { label: 'авто', hint: 'делает программа' },
  both: { label: 'авто + глазами', hint: 'данные собирает программа, решение за человеком' },
  manual: { label: 'глазами', hint: 'только вручную' },
  service: { label: 'сервисы', hint: 'нужны внешние данные' },
}

// ── данные ───────────────────────────────────────────────────────────────────

const checklist = JSON.parse(readFileSync(path.join(root, 'src/checklist/checklist.json'), 'utf8'))
const rules = allRules()
const areas = rulesByArea()
const steps = readSteps()

const checks = checklist.sections.flatMap((section) => section.checks)
const automated = checks.filter((check) => check.kind === 'auto' || check.kind === 'both').length
const manual = checks.length - automated

/** Достаёт нумерованный список из раздела «Порядок работы» в AGENT.md. */
function readSteps() {
  const text = readFileSync(path.join(root, 'AGENT.md'), 'utf8')
  const section = text.split('## Порядок работы')[1]?.split('\n## ')[0] || ''

  return section
    .split('\n')
    .filter((line) => /^\d+\.\s/.test(line))
    .map((line) => line.replace(/^\d+\.\s/, '').trim())
}

// ── сборка ───────────────────────────────────────────────────────────────────

const html = page()

mkdirSync(path.join(root, 'docs'), { recursive: true })
writeFileSync(path.join(root, 'docs/index.html'), html, 'utf8')

console.log(`  docs/index.html собран, ${Math.round(html.length / 1024)} КБ`)
console.log(`  инструментов ${TOOLS.length}, правил ${rules.length}, проверок ${checks.length}`)

// ── разметка ─────────────────────────────────────────────────────────────────

function page() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ревизор — MCP-сервер и агент для проверки сайтов</title>
<meta name="description" content="Открытый MCP-сервер и агент, который проверяет сайт по чек-листу из ${checks.length} пунктов и собирает отчёт. ${TOOLS.length} инструментов, ${rules.length} правил.">
<meta property="og:title" content="Ревизор — проверка сайта по чек-листу">
<meta property="og:description" content="MCP-сервер и агент: ${TOOLS.length} инструментов, ${rules.length} правил, отчёт со сравнением прогонов.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600;7..72,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>${style()}</style>
</head>
<body>
${hero()}
${nav()}
<main>
${about()}
${toolsSection()}
${orderSection()}
${checklistSection()}
${rulesSection()}
${startSection()}
</main>
${footer()}
<script>${script()}</script>
</body>
</html>
`
}

function hero() {
  return `<header class="hero">
  <div class="wrap">
    <p class="kicker">MCP-сервер · агент · открытый код</p>
    <h1>Ревизор</h1>
    <p class="lede">Проверяет сайт по чек-листу и собирает отчёт, в котором по каждой находке
    сказано три вещи: что не так, почему это плохо и что конкретно сделать.</p>
    <dl class="facts">
      ${fact(TOOLS.length, 'инструментов')}
      ${fact(rules.length, 'правил в коде')}
      ${fact(checks.length, 'пунктов чек-листа')}
      ${fact(automated, 'из них автоматизировано')}
    </dl>
    <p class="cta">
      <a class="btn btn--main" href="${REPO}">Открыть на GitHub</a>
      <span class="btn btn--soon" aria-disabled="true">Телеграм-бот · скоро</span>
    </p>
  </div>
</header>`
}

function fact(value, label) {
  return `<div><dd>${value}</dd><dt>${esc(label)}</dt></div>`
}

function nav() {
  const items = [
    ['#about', 'Что это'],
    ['#tools', 'Инструменты'],
    ['#order', 'Порядок проверки'],
    ['#checklist', 'Чек-листы'],
    ['#rules', 'Правила'],
    ['#start', 'Запуск'],
  ]

  return `<nav class="nav"><div class="wrap">
    ${items.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('')}
  </div></nav>`
}

function about() {
  return `<section class="sec" id="about"><div class="wrap narrow">
  <h2>Что это</h2>
  <p>Обычный SEO-аудит делают руками по списку: открыть robots.txt, посмотреть заголовки,
  проверить зеркала, прокликать ссылки. Работа механическая, но пропустить пункт легко,
  а цена пропуска высокая — одна строка в robots.txt закрывает сайт от поиска целиком.</p>

  <p>Ревизор состоит из двух частей. <strong>Сервер</strong> — набор функций, каждая проверяет
  свой участок и возвращает данные. <strong>Агент</strong> — цикл, который сам решает,
  какую функцию вызвать следующей, исходя из того, что нашлось на предыдущем шаге.
  Карта сайта нашлась — берём из неё страницы; не нашлась — идём по ссылкам с главной.
  Сколько будет вызовов, заранее не знает никто.</p>

  <p class="note">Сервер работает на вашей машине и никуда ничего не отправляет.
  Проверять чужие сайты без разрешения владельца не стоит: обход создаёт нагрузку.</p>
  </div></section>`
}

function toolsSection() {
  return `<section class="sec sec--alt" id="tools"><div class="wrap">
  <h2>Инструменты</h2>
  <p class="intro">Ровно то, что сервер отвечает на вопрос «какие у тебя есть инструменты».
  Описания читает модель — по ним она понимает, когда какой вызывать.</p>
  <div class="tools">
    ${TOOLS.map(
      (tool) => `<article class="tool">
      <h3>${esc(tool.title)}</h3>
      <code>${esc(tool.name)}</code>
      <p>${esc(tool.description)}</p>
    </article>`,
    ).join('')}
  </div>
  </div></section>`
}

function orderSection() {
  return `<section class="sec" id="order"><div class="wrap narrow">
  <h2>Порядок проверки</h2>
  <p class="intro">Последовательность не случайная: каждый шаг опирается на предыдущий.
  Зеркала идут первыми, потому что пока поисковик видит вместо одного сайта три копии,
  остальные правки почти бессмысленны.</p>
  <ol class="order">
    ${steps.map((step) => `<li>${inline(step)}</li>`).join('')}
  </ol>
  </div></section>`
}

function checklistSection() {
  const legend = Object.entries(KINDS)
    .map(([kind, { label, hint }]) => `<li><span class="tag tag--${kind}">${esc(label)}</span> ${esc(hint)}</li>`)
    .join('')

  return `<section class="sec sec--alt" id="checklist"><div class="wrap">
  <h2>Чек-листы</h2>
  <p class="intro">Полный список из ${checks.length} проверок в ${plural(checklist.sections.length, ['разделе', 'разделах', 'разделах'])}.
  У каждой сказано, почему это важно и как проверяется. Автоматизировать удалось ${automated};
  оставшиеся ${manual} требуют человека или платных сервисов — и это не недоделка,
  а честная граница: оценить, понятен ли заголовок категории живому человеку, программа не может.</p>

  <ul class="legend">${legend}</ul>

  <div class="filters" role="group" aria-label="Отбор проверок">
    <button type="button" data-filter="all" class="on">Все ${checks.length}</button>
    <button type="button" data-filter="machine">Делает программа ${automated}</button>
    <button type="button" data-filter="human">Нужен человек ${manual}</button>
  </div>

  <div class="lists" data-mode="all">
    ${checklist.sections.map(checklistBlock).join('')}
  </div>
  </div></section>`
}

function checklistBlock(section) {
  const machine = section.checks.filter((check) => check.kind === 'auto' || check.kind === 'both').length

  return `<section class="block" data-machine="${machine}" data-human="${section.checks.length - machine}">
  <h3>${esc(section.title)} <span class="count">${section.checks.length}</span></h3>
  <p class="block__intro">${esc(section.intro)}</p>
  <ol class="checks">
    ${section.checks.map(checkItem).join('')}
  </ol>
  </section>`
}

function checkItem(check) {
  const side = check.kind === 'auto' || check.kind === 'both' ? 'machine' : 'human'

  return `<li class="chk" data-side="${side}">
    <div class="chk__head">
      <h4>${esc(check.title)}</h4>
      <span class="tag tag--${check.kind}">${esc(KINDS[check.kind].label)}</span>
    </div>
    <p class="chk__why">${esc(check.why)}</p>
    <p class="chk__how"><span>Как проверить</span>${esc(check.how)}</p>
  </li>`
}

function rulesSection() {
  const counts = {}
  for (const rule of rules) counts[rule.severity] = (counts[rule.severity] || 0) + 1

  const rows = areas
    .map(
      (group) => `<tr>
      <td>${esc(group.area)}</td>
      <td class="num">${group.total}</td>
    </tr>`,
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
  <h2>Правила</h2>
  <p class="intro">Формулировки замечаний вынесены из кода в файлы данных: ${rules.length} правил,
  у каждого свой постоянный идентификатор. Это даёт две вещи. Текст можно править,
  не трогая логику проверок. И два прогона можно сравнить между собой —
  видно, что исправлено, а что появилось.</p>

  <div class="cols">
    <table class="table">
      <caption>По областям</caption>
      <tbody>${rows}</tbody>
    </table>
    <table class="table">
      <caption>По важности</caption>
      <tbody>
        ${Object.entries(counts)
          .map(([level, count]) => `<tr><td>${esc(SEVERITY_LABELS[level])}</td><td class="num">${count}</td></tr>`)
          .join('')}
      </tbody>
    </table>
  </div>

  <h3 class="sub">Как выглядит находка</h3>
  <div class="findings">${examples}</div>
  </div></section>`
}

function exampleFinding(rule) {
  return `<article class="finding finding--${rule.severity}">
    <div class="finding__head">
      <span class="sev">${esc(SEVERITY_LABELS[rule.severity])}</span>
      <h4>${esc(rule.title)}</h4>
    </div>
    <p class="finding__msg">${esc(rule.message)}</p>
    <p class="finding__row"><span>Почему это плохо</span>${esc(rule.why)}</p>
    <p class="finding__row"><span>Что делать</span>${esc(rule.fix)}</p>
  </article>`
}

function startSection() {
  return `<section class="sec sec--alt" id="start"><div class="wrap narrow">
  <h2>Запуск</h2>
  <p class="intro">Нужен Node.js 22 или новее. Ключи не обязательны:
  без них пропускается только измерение скорости.</p>

  <pre><code>git clone ${REPO}.git
cd seo-revizor
npm install
npm run check meta https://example.com/</code></pre>

  <p>Файл <code>.mcp.json</code> уже в репозитории — откройте папку в Claude Code
  или другом клиенте с поддержкой MCP, и инструменты появятся в списке.
  Дальше можно просто попросить: «следуй AGENT.md и проверь сайт такой-то».</p>

  <p>Полное описание, устройство и разбор каждого файла — в
  <a href="${REPO}#readme">README репозитория</a>.</p>
  </div></section>`
}

function footer() {
  return `<footer class="foot"><div class="wrap">
  <p>Ревизор — открытый код под лицензией MIT.
  <a href="${REPO}">github.com/qa-novchenkova/seo-revizor</a></p>
  <p class="foot__note">Страница собрана из файлов проекта: инструменты из сервера,
  правила из чек-листа, порядок из инструкции агенту. Поэтому она не расходится с кодом.</p>
  </div></footer>`
}

function script() {
  return `
document.querySelectorAll('.filters button').forEach(function (button) {
  button.addEventListener('click', function () {
    document.querySelectorAll('.filters button').forEach(function (other) {
      other.classList.toggle('on', other === button);
    });
    document.querySelector('.lists').dataset.mode = button.dataset.filter;
  });
});`
}

// ── стили ────────────────────────────────────────────────────────────────────

function style() {
  return `
:root {
  --paper: #F2F5F4; --surface: #FFFFFF; --raise: #FAFBFB; --deep: #10201E;
  --ink: #121917; --ink-soft: #46524F; --ink-mute: #5B6864;
  --line: #DCE4E1; --line-hard: #C2CECA;
  --accent: #1A6F69; --accent-ink: #0E4A46; --accent-soft: #E1EFEC;
  --crit: #A82A2E; --warn: #8A6106; --ok: #2C6E4C; --info: #2C5AA8;
  --f-head: 'Literata', Georgia, 'Times New Roman', serif;
  --f-body: 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif;
  --f-mono: 'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0E1413; --surface: #151D1B; --raise: #1B2523; --deep: #060B0A;
    --ink: #E7EEEC; --ink-soft: #AEBAB7; --ink-mute: #909D99;
    --line: #232E2C; --line-hard: #35433F;
    --accent: #4FB8AF; --accent-ink: #8FD9D2; --accent-soft: #143330;
    --crit: #F0797C; --warn: #DEA94F; --ok: #6CC38F; --info: #7EA4EC;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: var(--f-body); font-size: 16.5px; line-height: 1.66;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent-ink); }
:focus-visible { outline: 2.5px solid var(--accent); outline-offset: 3px; border-radius: 3px; }
h1, h2, h3, h4 { font-family: var(--f-head); letter-spacing: -.02em; text-wrap: balance; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.wrap.narrow { max-width: 760px; }

/* ---------- шапка ---------- */
.hero { background: var(--deep); color: #EAF2F0; padding: 76px 0 62px; }
.kicker {
  margin: 0 0 16px; font-family: var(--f-mono); font-size: .7rem; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; color: #7FCFC7;
}
.hero h1 { margin: 0; font-size: clamp(2.9rem, 8vw, 5rem); line-height: .98; font-weight: 700; }
.lede { margin: 20px 0 0; font-size: 1.16rem; max-width: 58ch; color: #C3D3D0; }

.facts { display: flex; flex-wrap: wrap; gap: 12px; margin: 38px 0 0; padding: 0; }
.facts div {
  flex: 1 1 150px; border: 1px solid #24403C; border-radius: 10px;
  padding: 14px 16px; background: #14262400;
}
.facts dd {
  margin: 0; font-family: var(--f-head); font-weight: 700;
  font-size: 1.9rem; line-height: 1; font-variant-numeric: tabular-nums; color: #EAF2F0;
}
.facts dt {
  margin: 6px 0 0; font-family: var(--f-mono); font-size: .64rem; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: #8EA8A4;
}

.cta { display: flex; flex-wrap: wrap; gap: 12px; margin: 34px 0 0; }
.btn {
  display: inline-block; padding: 12px 22px; border-radius: 9px;
  font-weight: 600; font-size: .95rem; text-decoration: none;
}
.btn--main { background: #4FB8AF; color: #07211F; }
.btn--main:hover { background: #6FCCC4; }
.btn--soon { border: 1px solid #2C4A46; color: #8EA8A4; }

/* ---------- меню ---------- */
.nav {
  position: sticky; top: 0; z-index: 5;
  background: var(--surface); border-bottom: 1px solid var(--line);
}
.nav .wrap { display: flex; gap: 4px; overflow-x: auto; }
.nav a {
  padding: 13px 14px; font-size: .88rem; text-decoration: none;
  color: var(--ink-soft); white-space: nowrap; border-bottom: 2px solid transparent;
}
.nav a:hover { color: var(--accent-ink); border-bottom-color: var(--accent); }

/* ---------- разделы ---------- */
.sec { padding: 62px 0; scroll-margin-top: 52px; }
.sec--alt { background: var(--surface); border-block: 1px solid var(--line); }
.sec h2 { margin: 0 0 18px; font-size: clamp(1.7rem, 3.6vw, 2.3rem); font-weight: 700; }
.sub { margin: 44px 0 16px; font-size: 1.3rem; font-weight: 700; }
.intro { margin: 0 0 30px; color: var(--ink-soft); max-width: 64ch; }
.sec p { max-width: 68ch; }
.note {
  border-left: 3px solid var(--accent); padding-left: 14px;
  color: var(--ink-soft); font-size: .95rem;
}

/* ---------- инструменты ---------- */
.tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(298px, 1fr)); gap: 14px; }
.tool { background: var(--raise); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
.tool h3 { margin: 0; font-size: 1.08rem; font-weight: 700; }
.tool code {
  display: inline-block; margin: 7px 0 10px; font-family: var(--f-mono);
  font-size: .74rem; color: var(--accent-ink);
  background: var(--accent-soft); padding: 2px 7px; border-radius: 5px;
}
.tool p { margin: 0; font-size: .91rem; color: var(--ink-soft); }

/* ---------- порядок ---------- */
.order { margin: 0; padding: 0; list-style: none; counter-reset: s; }
.order li {
  counter-increment: s; position: relative; padding: 14px 0 14px 52px;
  border-top: 1px solid var(--line); color: var(--ink-soft); font-size: .95rem;
}
.order li:last-child { border-bottom: 1px solid var(--line); }
.order li::before {
  content: counter(s, decimal-leading-zero); position: absolute; left: 0; top: 15px;
  font-family: var(--f-mono); font-size: .72rem; font-weight: 600; color: var(--accent-ink);
}
.order code, .sec p code, pre code {
  font-family: var(--f-mono); font-size: .86em;
}
.order code { color: var(--ink); background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }

/* ---------- чек-листы ---------- */
.legend { margin: 0 0 24px; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px 20px; }
.legend li { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--ink-soft); }

.filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 26px; }
.filters button {
  font: inherit; font-size: .87rem; cursor: pointer;
  padding: 8px 16px; border-radius: 8px;
  border: 1px solid var(--line-hard); background: var(--raise); color: var(--ink-soft);
}
.filters button:hover { border-color: var(--accent); }
.filters button.on { background: var(--accent); border-color: var(--accent); color: #FFF; }
@media (prefers-color-scheme: dark) { .filters button.on { color: #06201D; } }

.block { margin: 0 0 44px; }
.block h3 { margin: 0 0 6px; font-size: 1.32rem; font-weight: 700; }
.block h3 .count {
  font-family: var(--f-mono); font-size: .68rem; font-weight: 600;
  color: var(--ink-mute); vertical-align: middle; margin-left: 6px;
}
.block__intro { margin: 0 0 16px; color: var(--ink-soft); font-size: .93rem; max-width: 66ch; }

.checks { margin: 0; padding: 0; list-style: none; counter-reset: c; }
.chk {
  counter-increment: c; position: relative;
  background: var(--raise); border: 1px solid var(--line);
  padding: 15px 18px 15px 48px;
}
.chk:first-child { border-radius: 11px 11px 0 0; }
.chk:last-child { border-radius: 0 0 11px 11px; }
.chk + .chk { border-top: none; }
.chk::before {
  content: counter(c, decimal-leading-zero); position: absolute; left: 17px; top: 17px;
  font-family: var(--f-mono); font-size: .7rem; font-weight: 600; color: var(--ink-mute);
  font-variant-numeric: tabular-nums;
}
.chk__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.chk__head h4 { margin: 0; font-size: 1.02rem; font-weight: 700; }
.chk__why { margin: 6px 0 0; font-size: .92rem; color: var(--ink-soft); }
.chk__how {
  margin: 9px 0 0; font-size: .87rem; color: var(--ink-soft);
  border-left: 2px solid var(--accent); padding-left: 12px;
}
.chk__how span {
  display: block; font-family: var(--f-mono); font-size: .63rem; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 2px;
}

.tag {
  flex: none; font-family: var(--f-mono); font-size: .62rem; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 5px; white-space: nowrap;
  border: 1px solid currentColor;
}
.tag--auto { color: var(--ok); }
.tag--both { color: var(--accent-ink); }
.tag--manual { color: var(--warn); }
.tag--service { color: var(--info); }

/* отбор: прячем неподходящие пункты и опустевшие разделы */
.lists[data-mode="machine"] .chk[data-side="human"],
.lists[data-mode="human"] .chk[data-side="machine"] { display: none; }
.lists[data-mode="machine"] .block[data-machine="0"],
.lists[data-mode="human"] .block[data-human="0"] { display: none; }
.lists[data-mode="machine"] .chk[data-side="machine"]:first-of-type,
.lists[data-mode="human"] .chk[data-side="human"]:first-of-type { border-radius: 11px 11px 0 0; }
.lists[data-mode="machine"] .chk[data-side="machine"]:last-of-type,
.lists[data-mode="human"] .chk[data-side="human"]:last-of-type { border-radius: 0 0 11px 11px; }

/* ---------- правила ---------- */
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
.table { width: 100%; border-collapse: collapse; font-size: .92rem; }
.table caption {
  text-align: left; font-family: var(--f-mono); font-size: .66rem; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--ink-mute); padding-bottom: 8px;
}
.table td { padding: 9px 0; border-bottom: 1px solid var(--line); color: var(--ink-soft); }
.table .num { text-align: right; font-family: var(--f-mono); font-variant-numeric: tabular-nums; color: var(--ink); }

.findings { display: grid; gap: 12px; }
.finding {
  background: var(--raise); border: 1px solid var(--line);
  border-left: 3px solid var(--line-hard); border-radius: 10px; padding: 17px 19px;
}
.finding--critical { border-left-color: var(--crit); }
.finding--important { border-left-color: var(--warn); }
.finding--minor { border-left-color: var(--ink-mute); }
.finding__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.finding__head h4 { margin: 0; font-size: 1.04rem; font-weight: 700; }
.sev {
  font-family: var(--f-mono); font-size: .62rem; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase;
}
.finding--critical .sev { color: var(--crit); }
.finding--important .sev { color: var(--warn); }
.finding--minor .sev { color: var(--ink-mute); }
.finding__msg { margin: 8px 0 0; font-size: .95rem; }
.finding__row { margin: 8px 0 0; font-size: .89rem; color: var(--ink-soft); }
.finding__row span {
  display: block; font-family: var(--f-mono); font-size: .62rem; font-weight: 600;
  letter-spacing: .11em; text-transform: uppercase; color: var(--ink-mute);
}

/* ---------- запуск ---------- */
pre {
  background: var(--deep); color: #D8E6E3; border-radius: 11px;
  padding: 18px 20px; overflow-x: auto; font-size: .87rem; line-height: 1.7;
}
pre code { font-family: var(--f-mono); }
.sec p code { background: var(--accent-soft); color: var(--ink); padding: 1px 5px; border-radius: 4px; }

/* ---------- подвал ---------- */
.foot { background: var(--deep); color: #A9BFBB; padding: 40px 0; font-size: .88rem; }
.foot a { color: #7FCFC7; }
.foot p { margin: 0; max-width: 70ch; }
.foot__note { margin-top: 10px; color: #7C918D; font-size: .82rem; }

@media (max-width: 560px) {
  body { font-size: 16px; }
  .hero { padding: 52px 0 44px; }
  .sec { padding: 46px 0; }
  .chk { padding: 14px 15px 14px 42px; }
  .chk__head { flex-wrap: wrap; }
  .chk__head h4 { flex: 1 1 100%; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
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
