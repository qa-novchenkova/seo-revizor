/**
 * Сборка документов отчёта: Markdown и HTML.
 *
 * Markdown — чтобы положить в задачу или в переписку.
 * HTML — чтобы показать человеку и превратить в PDF.
 *
 * Оба собираются из одних данных: связного текста от модели плюс находок,
 * которые агент собрал из ответов инструментов.
 */
import { SEVERITIES, SEVERITY_LABELS } from './rules/index.js'

const TITLE = 'Аудит сайта'

function formatDate(iso) {
  const date = new Date(iso)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function counts(findings) {
  const result = {}
  for (const level of SEVERITIES) result[level] = 0
  for (const finding of findings) result[finding.severity] += 1
  return result
}

function groupBySeverity(findings) {
  return SEVERITIES.map((level) => ({
    level,
    label: SEVERITY_LABELS[level],
    items: findings.filter((finding) => finding.severity === level),
  })).filter((group) => group.items.length)
}

/** Короткий адрес для таблицы: без схемы и домена. */
function shortPath(url, site) {
  try {
    const parsed = new URL(url)
    const base = new URL(site)
    if (parsed.host === base.host) return parsed.pathname + parsed.search || '/'
    return parsed.host + parsed.pathname
  } catch {
    return url
  }
}

// ── Markdown ─────────────────────────────────────────────────────────────────

export function toMarkdown(run, diff = null) {
  const total = run.findings.length
  const byLevel = counts(run.findings)
  const lines = []

  lines.push(`# ${TITLE}: ${run.site}`)
  lines.push('')
  lines.push(`Дата проверки: ${formatDate(run.finishedAt)}`)
  lines.push(`Проверено страниц: ${run.pages.length}. Вызовов инструментов: ${run.calls.length}.`)
  lines.push('')
  lines.push(
    `Найдено ${total}: критично — ${byLevel.critical}, важно — ${byLevel.important}, мелочь — ${byLevel.minor}.`,
  )
  lines.push('')

  if (diff) {
    lines.push('## Что изменилось с прошлой проверки')
    lines.push('')
    lines.push(`Сравнение с ${formatDate(diff.previousAt)} по ${diff.comparedPages.length} общим страницам.`)
    lines.push('')
    lines.push(`- Исправлено: ${diff.fixed.length}`)
    lines.push(`- Появилось нового: ${diff.appeared.length}`)
    lines.push(`- Осталось как было: ${diff.stayed.length}`)
    lines.push('')

    if (diff.fixed.length) {
      lines.push('**Исправлено:**')
      lines.push('')
      for (const finding of diff.fixed) {
        lines.push(`- ${finding.title} — ${shortPath(finding.url, run.site)}`)
      }
      lines.push('')
    }

    if (diff.appeared.length) {
      lines.push('**Появилось после прошлой проверки:**')
      lines.push('')
      for (const finding of diff.appeared) {
        lines.push(`- [${SEVERITY_LABELS[finding.severity]}] ${finding.title} — ${shortPath(finding.url, run.site)}`)
      }
      lines.push('')
    }
  }

  if (run.report) {
    lines.push('## Заключение')
    lines.push('')
    lines.push(run.report.trim())
    lines.push('')
  }

  lines.push('## Находки')
  lines.push('')

  if (!total) {
    lines.push('Проверки не выявили замечаний.')
  } else {
    for (const group of groupBySeverity(run.findings)) {
      lines.push(`### ${group.label[0].toUpperCase() + group.label.slice(1)} — ${group.items.length}`)
      lines.push('')
      for (const finding of group.items) {
        lines.push(`#### ${finding.title}`)
        lines.push('')
        lines.push(`Страница: ${finding.url}`)
        lines.push('')
        lines.push(finding.message)
        lines.push('')
        lines.push(`**Почему это важно.** ${finding.why}`)
        lines.push('')
        lines.push(`**Что делать.** ${finding.fix}`)
        lines.push('')
      }
    }
  }

  lines.push('## Проверенные страницы')
  lines.push('')
  for (const page of run.pages) lines.push(`- ${page}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('Отчёт собран автоматически. Часть пунктов чек-листа проверяется только вручную.')

  return lines.join('\n')
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const escape = (value) =>
  String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

/**
 * Разметка внутри строки.
 *
 * Модель пишет заключение на Markdown — так же, как пишет их человек. В файле
 * .md это и нужно, а в HTML и PDF звёздочки должны стать оформлением, иначе
 * отчёт выглядит как черновик. Экранирование идёт первым: чужая разметка
 * не может превратиться в теги.
 */
function inline(text) {
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

/** Пункты списка: строка-маркер отбрасывается, пустые строки выкидываются. */
function listItems(block, marker) {
  return block
    .split('\n')
    .map((line) => line.replace(marker, '').trim())
    .filter(Boolean)
}

/** Разбор заключения модели: заголовки, списки, абзацы. */
export function paragraphs(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim()

      // Заголовки внутри заключения делаем подзаголовками: первый уровень
      // в документе уже занят названием отчёта.
      const heading = trimmed.match(/^#{1,6}\s+(.+)$/)
      if (heading) return `<h3 class="sub">${inline(heading[1])}</h3>`

      if (/^[-*]\s/m.test(trimmed)) {
        const items = listItems(trimmed, /^[-*]\s*/)
        return `<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`
      }

      if (/^\d+[.)]\s/m.test(trimmed)) {
        const items = listItems(trimmed, /^\d+[.)]\s*/)
        return `<ol>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`
      }

      return `<p>${inline(trimmed)}</p>`
    })
    .join('\n')
}

export function toHtml(run, diff = null) {
  const total = run.findings.length
  const byLevel = counts(run.findings)

  const stat = (label, value, level) =>
    `<div class="stat stat--${level || 'plain'}"><dt>${label}</dt><dd>${value}</dd></div>`

  const findingBlock = (finding) => `
    <article class="finding finding--${finding.severity}">
      <div class="finding__head">
        <h3>${escape(finding.title)}</h3>
        <span class="tag tag--${finding.severity}">${SEVERITY_LABELS[finding.severity]}</span>
      </div>
      <p class="finding__where">${escape(shortPath(finding.url, run.site))}</p>
      <p class="finding__what">${escape(finding.message)}</p>
      <p class="finding__why"><span>Почему это важно</span>${escape(finding.why)}</p>
      <p class="finding__fix"><span>Что делать</span>${escape(finding.fix)}</p>
    </article>`

  const diffBlock = !diff
    ? ''
    : `
    <section class="section">
      <h2>Что изменилось</h2>
      <p class="muted">Сравнение с проверкой от ${formatDate(diff.previousAt)} по ${diff.comparedPages.length} общим страницам.</p>
      <dl class="stats">
        ${stat('Исправлено', diff.fixed.length, 'good')}
        ${stat('Появилось', diff.appeared.length, diff.appeared.length ? 'critical' : 'plain')}
        ${stat('Осталось', diff.stayed.length, 'plain')}
      </dl>
      ${
        diff.fixed.length
          ? `<h3 class="sub">Исправлено</h3><ul class="plain">${diff.fixed
              .map((f) => `<li><s>${escape(f.title)}</s> <span class="muted">${escape(shortPath(f.url, run.site))}</span></li>`)
              .join('')}</ul>`
          : ''
      }
      ${
        diff.appeared.length
          ? `<h3 class="sub">Появилось после прошлой проверки</h3><ul class="plain">${diff.appeared
              .map(
                (f) =>
                  `<li><span class="tag tag--${f.severity}">${SEVERITY_LABELS[f.severity]}</span> ${escape(f.title)} <span class="muted">${escape(shortPath(f.url, run.site))}</span></li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </section>`

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}: ${escape(run.site)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="page">

  <header class="head">
    <p class="kicker">${TITLE}</p>
    <h1>${escape(run.site)}</h1>
    <p class="muted">Проверка от ${formatDate(run.finishedAt)} · страниц: ${run.pages.length} · вызовов инструментов: ${run.calls.length}</p>
    <dl class="stats">
      ${stat('Критично', byLevel.critical, byLevel.critical ? 'critical' : 'plain')}
      ${stat('Важно', byLevel.important, byLevel.important ? 'important' : 'plain')}
      ${stat('Мелочь', byLevel.minor, 'plain')}
      ${stat('Всего', total, 'plain')}
    </dl>
  </header>

  ${diffBlock}

  ${run.report ? `<section class="section"><h2>Заключение</h2><div class="prose">${paragraphs(run.report)}</div></section>` : ''}

  <section class="section">
    <h2>Находки</h2>
    ${
      total
        ? groupBySeverity(run.findings)
            .map(
              (group) => `
      <h3 class="sub">${group.label[0].toUpperCase() + group.label.slice(1)} — ${group.items.length}</h3>
      ${group.items.map(findingBlock).join('')}`,
            )
            .join('')
        : '<p class="muted">Проверки не выявили замечаний.</p>'
    }
  </section>

  <section class="section">
    <h2>Проверенные страницы</h2>
    <ul class="plain mono">${run.pages.map((page) => `<li>${escape(page)}</li>`).join('')}</ul>
  </section>

  <footer class="foot">
    Отчёт собран автоматически инструментом «Ревизор».
    Часть пунктов чек-листа проверяется только вручную и в этот документ не попадает.
  </footer>

</main>
</body>
</html>`
}

/**
 * Стили встроены в файл, а шрифты берутся системные.
 * Так документ открывается без интернета и одинаково печатается в PDF.
 */
const STYLE = `
  :root {
    --ink: #16181d; --soft: #474d54; --mute: #61686f;
    --line: #dfe3e8; --paper: #ffffff; --panel: #f6f7f9;
    --critical: #b3261e; --important: #9a6209; --minor: #4a5560; --good: #216e46;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #eceef1; color: var(--ink);
    font: 15px/1.6 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 900px; margin: 0 auto; padding: 40px 32px 60px; background: var(--paper); }

  .kicker { margin: 0 0 6px; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--mute); }
  h1 { margin: 0; font-size: 30px; line-height: 1.15; letter-spacing: -.02em; word-break: break-word; }
  h2 { margin: 0 0 14px; font-size: 21px; letter-spacing: -.01em; }
  .sub { margin: 26px 0 12px; font-size: 15px; letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
  .muted { color: var(--mute); }

  .head { border-bottom: 2px solid var(--ink); padding-bottom: 22px; margin-bottom: 30px; }
  .head .muted { margin: 10px 0 0; font-size: 13px; }

  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0 0; }
  .stat { flex: 1 1 120px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; background: var(--panel); }
  .stat dt { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mute); }
  .stat dd { margin: 2px 0 0; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat--critical dd { color: var(--critical); }
  .stat--important dd { color: var(--important); }
  .stat--good dd { color: var(--good); }

  .section { margin: 0 0 34px; }
  .prose p { margin: 0 0 12px; }
  .prose ul, .prose ol { margin: 0 0 12px; padding-left: 20px; }
  .prose li { margin: 0 0 4px; }
  .prose h3 { margin: 18px 0 8px; }
  .prose strong { font-weight: 600; }
  .prose code { font-family: Consolas, "Courier New", monospace; font-size: 12.5px;
    background: var(--panel); padding: 1px 4px; border-radius: 3px; }

  .finding { border: 1px solid var(--line); border-left: 4px solid var(--minor); border-radius: 6px; padding: 14px 16px; margin: 0 0 10px; break-inside: avoid; }
  .finding--critical { border-left-color: var(--critical); }
  .finding--important { border-left-color: var(--important); }
  .finding__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .finding h3 { margin: 0; font-size: 16px; }
  .finding p { margin: 6px 0 0; }
  .finding__where { font-size: 12.5px; color: var(--mute); font-family: Consolas, "Courier New", monospace; word-break: break-all; }
  .finding__what { font-weight: 600; }
  .finding__why, .finding__fix { font-size: 14px; color: var(--soft); }
  .finding__why span, .finding__fix span {
    display: block; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--mute); margin-bottom: 1px;
  }

  .tag { flex: none; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; border: 1px solid currentColor; }
  .tag--critical { color: var(--critical); }
  .tag--important { color: var(--important); }
  .tag--minor { color: var(--minor); }

  ul.plain { list-style: none; margin: 0; padding: 0; }
  ul.plain li { padding: 4px 0; border-bottom: 1px solid var(--line); }
  ul.mono { font-family: Consolas, "Courier New", monospace; font-size: 12.5px; word-break: break-all; }

  .foot { border-top: 1px solid var(--line); padding-top: 16px; font-size: 12.5px; color: var(--mute); }

  @page { size: A4; margin: 16mm 14mm; }
  @media print {
    body { background: var(--paper); }
    .page { max-width: none; padding: 0; }
    .section { break-inside: auto; }
    h2, .sub { break-after: avoid; }
  }
`
