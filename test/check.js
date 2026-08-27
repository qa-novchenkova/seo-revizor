/**
 * Запуск проверок НАПРЯМУЮ, без модели и без протокола.
 *
 * Это первое, чем стоит пользоваться при разработке: если функция здесь
 * работает неправильно, через MCP она правильнее не станет.
 *
 *   node test/check.js url     https://example.com/
 *   node test/check.js meta    https://example.com/
 *   node test/check.js robots  https://example.com/
 *   node test/check.js sitemap https://example.com/
 */
import { checkUrl } from '../src/checks/url.js'
import { checkMeta } from '../src/checks/meta.js'
import { checkRobots } from '../src/checks/robots.js'
import { checkSitemap } from '../src/checks/sitemap.js'
import { checkLinks } from '../src/checks/links.js'
import { checkMirrors } from '../src/checks/mirrors.js'
import { checkSecurity } from '../src/checks/security.js'
import { checkAnalytics } from '../src/checks/analytics.js'
import { checkContent } from '../src/checks/content.js'
import { checkSpeed } from '../src/checks/speed.js'
import { SEVERITY_LABELS, SEVERITIES } from '../src/rules/index.js'

const CHECKS = {
  url: { run: checkUrl, print: printUrl },
  meta: { run: checkMeta, print: printMeta },
  robots: { run: checkRobots, print: printRobots },
  sitemap: { run: checkSitemap, print: printSitemap },
  links: { run: checkLinks, print: printLinks },
  mirrors: { run: checkMirrors, print: printMirrors },
  security: { run: checkSecurity, print: printSecurity },
  analytics: { run: checkAnalytics, print: printAnalytics },
  content: { run: (target) => checkContent(target.split(',')), print: printContent },
  speed: { run: checkSpeed, print: printSpeed },
}

const [name, target] = process.argv.slice(2)

if (!CHECKS[name] || !target) {
  console.log('\n  Использование: node test/check.js <проверка> <адрес>')
  console.log('  Проверки: ' + Object.keys(CHECKS).join(', ') + '\n')
  process.exit(1)
}

const result = await CHECKS[name].run(target)

console.log('\n  ' + (result.url || target))
console.log('  ' + '─'.repeat(Math.min(76, Math.max(20, (result.url || target).length))))

if (result.ok === false) {
  console.log('  не получилось:', result.error || `код ${result.status}`)
} else {
  CHECKS[name].print(result)
}

printFindings(result)
console.log('')

// ── как показывать каждую проверку ───────────────────────────────────────────

function printUrl(r) {
  line('код ответа', r.status)
  line('редиректов', r.redirects)
  line('время ответа', r.responseMs + ' мс')

  if (r.redirects > 0) {
    console.log('\n  цепочка:')
    for (const step of r.chain) {
      console.log(`    ${String(step.status).padEnd(4)} ${step.url}${step.location ? '\n         → ' + step.location : ''}`)
    }
  }

  console.log('\n  заголовки:')
  for (const [key, value] of Object.entries(r.headers)) {
    console.log(`    ${key.padEnd(28)} ${value}`)
  }
}

function printMeta(r) {
  line('title', r.title ? `${r.title.length} симв.  ${cut(r.title.text, 60)}` : '— нет —')
  line('description', r.description ? `${r.description.length} симв.  ${cut(r.description.text, 60)}` : '— нет —')
  line('H1', r.h1.length ? r.h1.map((h) => cut(h, 60)).join(' | ') : '— нет —')
  line('заголовков всего', r.headings.length)
  line('canonical', r.canonical || '— нет —')
  line('lang', r.lang || '— нет —')
  line('meta robots', r.robotsMeta || '—')
  line('Open Graph', [r.og.title && 'title', r.og.description && 'description', r.og.image && 'image'].filter(Boolean).join(', ') || '— нет —')
  line('изображений', `${r.images.total}, без alt: ${r.images.withoutAlt}`)
  line('микроразметка', r.schemaTypes.length ? r.schemaTypes.join(', ') : '— нет —')
}

function printRobots(r) {
  line('существует', r.exists ? 'да' : 'нет')
  if (!r.exists) return
  line('размер', r.size + ' байт')
  line('групп правил', r.groups.length)
  line('карт сайта', r.sitemaps.length)
  for (const map of r.sitemaps) console.log(`      ${map}`)

  for (const group of r.groups.slice(0, 4)) {
    console.log(`\n    User-agent: ${group.userAgents.join(', ')}`)
    console.log(`      запретов: ${group.disallow.length}, разрешений: ${group.allow.length}`)
    for (const path of group.disallow.slice(0, 5)) console.log(`      Disallow: ${path}`)
    if (group.disallow.length > 5) console.log(`      … и ещё ${group.disallow.length - 5}`)
  }
}

function printSitemap(r) {
  line('тип', r.type === 'sitemapindex' ? 'карта карт' : 'список адресов')
  line('адресов всего', r.total)
  line('без даты изменения', r.withoutLastmod)

  if (r.nested.length) {
    console.log('\n  вложенные карты:')
    for (const child of r.nested) console.log(`    ${String(child.count).padStart(6)}  ${child.url}`)
  }

  if (r.pageTypes?.length) {
    console.log('\n  типы страниц:')
    for (const type of r.pageTypes) {
      console.log(`    ${String(type.total).padStart(6)}  ${type.shape}`)
    }
  }

  if (r.sample?.length) {
    console.log('\n  выборка для проверки — по одной странице каждого типа:')
    for (const page of r.sample) {
      console.log(`    ${page.shape.padEnd(22)} ${page.url}`)
    }
  }
}

function printLinks(r) {
  line('страниц обойдено', r.pagesCrawled)
  line('внутренних ссылок', r.internal.total)
  line('проверено из них', r.internal.checked)
  line('битых', r.internal.broken.length)
  line('через редирект', r.internal.redirects.length)
  line('внешних ссылок', r.external.total)
  line('без текста', r.anchors.empty)
  line('невнятный текст', r.anchors.vague)

  if (r.byShape.length) {
    console.log('\n  что видно в разметке:')
    for (const item of r.byShape.slice(0, 10)) {
      console.log(`    ${String(item.total).padStart(4)}  ${item.shape}`)
    }
  }

  if (r.internal.broken.length) {
    console.log('\n  битые:')
    for (const item of r.internal.broken.slice(0, 6)) {
      console.log(`    ${String(item.status ?? 'нет ответа').padEnd(12)} ${item.url}`)
    }
  }

  if (r.internal.redirects.length) {
    console.log('\n  через редирект:')
    for (const item of r.internal.redirects.slice(0, 6)) {
      console.log(`    ${item.url}\n         → ${item.to}`)
    }
  }

  if (r.external.hosts.length) {
    console.log('\n  внешние домены: ' + r.external.hosts.slice(0, 8).join(', '))
  }
}

function printMirrors(r) {
  line('без www', r.mirrors.withoutWww.status + (r.mirrors.withoutWww.redirectsTo ? ' → ' + r.mirrors.withoutWww.redirectsTo : ''))
  line('с www', r.mirrors.withWww.status + (r.mirrors.withWww.redirectsTo ? ' → ' + r.mirrors.withWww.redirectsTo : ''))
  line('http', 'шагов ' + r.insecure.hops + ', итог ' + r.insecure.finalStatus)
  line('дубли главной', r.indexDuplicates.length ? r.indexDuplicates.join(', ') : 'нет')
  line('слэш', r.slash ? `со слэшем ${r.slash.withSlash}, без ${r.slash.withoutSlash}` : 'не проверялся')
  line('несуществующая', r.missingPageStatus)
}

function printSecurity(r) {
  if (r.certificate) {
    line('сертификат', r.certificate.error || `до ${r.certificate.validTo}, осталось ${r.certificate.daysLeft} дн.`)
  }
  line('cookie', r.cookies)
  line('служебные файлы', r.exposedFiles.length ? r.exposedFiles.join(', ') : 'закрыты')
  line('листинг папок', r.directoryListings.length ? r.directoryListings.join(', ') : 'выключен')
  line('смешанное', r.mixedContent.length)

  const guards = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'content-security-policy']
  console.log('\n' + '  защитные заголовки:')
  for (const name of guards) {
    console.log(`    ${name.padEnd(28)} ${r.headers[name] ? 'есть' : '— нет —'}`)
  }
}

function printAnalytics(r) {
  line('найдено', r.summaryLine)
  for (const counter of r.counters) {
    console.log(`    ${counter.name.padEnd(22)} подключений: ${counter.count}${counter.blocking ? ', синхронно' : ''}`)
  }
}

function printContent(r) {
  line('страниц сравнено', r.checked)
  line('пар с дублями', r.duplicates.length)
  line('телефонов найдено', r.phones.length)
  console.log('\n' + '  объём страниц:')
  for (const page of r.pages) {
    console.log(`    ${String(page.words).padStart(6)} слов  ${shortUrl(page.url)}`)
  }
}

function printSpeed(r) {
  if (r.needsKey) {
    console.log('  ' + r.hint)
    return
  }
  line('оценка', r.score + ' из 100')
  for (const [name, value] of Object.entries(r.metrics)) {
    if (value) line(name.toUpperCase(), value)
  }
  if (r.opportunities.length) {
    console.log('\n' + '  что тормозит:')
    for (const item of r.opportunities) {
      const saving = item.unit === 'ms' ? Math.round(item.saving) + ' мс' : Math.round(item.saving / 1024) + ' КБ'
      console.log(`    ${saving.padStart(9)}  ${item.title}`)
    }
  }
}

function shortUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search || '/'
  } catch {
    return url
  }
}

/**
 * Находки печатаются по важности: сначала критичное. Для каждой видно,
 * что не так, почему это плохо и что делать. Тексты берутся из реестра правил.
 */
function printFindings(result) {
  const findings = result.findings || []

  if (!findings.length) {
    console.log('\n  замечаний нет')
    return
  }

  const counts = result.summary || {}
  const parts = SEVERITIES.filter((level) => counts[level]).map(
    (level) => `${SEVERITY_LABELS[level]}: ${counts[level]}`,
  )
  console.log(`\n  найдено ${findings.length} (${parts.join(', ')})`)

  for (const finding of findings) {
    console.log(`\n  [${SEVERITY_LABELS[finding.severity]}] ${finding.title}`)
    console.log(`    ${finding.message}`)
    console.log(`    почему:     ${finding.why}`)
    console.log(`    что делать: ${finding.fix}`)
    if (finding.examples?.length) {
      console.log(`    например:   ${finding.examples.slice(0, 2).join(', ')}`)
    }
  }
}

function line(label, value) {
  console.log(`  ${String(label).padEnd(20)} ${value}`)
}

function cut(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
