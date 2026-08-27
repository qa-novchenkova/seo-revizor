/**
 * Проверка сборки документов и печати в PDF — без модели и без ключа.
 *
 * Берём заранее записанный прогон, собираем Markdown, HTML и PDF,
 * потом делаем второй прогон с изменёнными находками и сверяем сравнение.
 *
 *   node test/report.js
 */
import assert from 'node:assert/strict'
import { existsSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'

import { toMarkdown, toHtml } from '../src/report.js'
import { saveRun, previousRun, compare, folderFor } from '../src/store.js'
import { htmlToPdf, findBrowser } from '../src/pdf.js'

const SITE = 'https://пример-для-теста.local/'

function finding(id, severity, title, url) {
  return {
    id,
    severity,
    title,
    url,
    area: 'Проверка',
    message: `${title}: короткое описание того, что не так.`,
    why: 'Объяснение, почему это важно для поиска и для человека.',
    fix: 'Что нужно сделать, чтобы это исправить.',
  }
}

function run(iso, findings, pages) {
  return {
    site: SITE,
    model: 'заглушка',
    finishedAt: iso,
    report: 'Сайт в целом рабочий.\n\nНо технической основы для поиска почти нет.',
    findings,
    pages,
    calls: [{ name: 'check_meta', ok: true }, { name: 'check_links', ok: true }],
    stoppedBy: 'end_turn',
    usage: { inputTokens: 1000, outputTokens: 500, cost: 0.0175 },
  }
}

// Чистим за собой, чтобы прошлые запуски теста не влияли на сравнение
const dir = path.join('reports', folderFor(SITE))
rmSync(dir, { recursive: true, force: true })

console.log('\n  Проверка сборки отчёта\n')

// ── первый прогон ────────────────────────────────────────────────────────────
const first = run(
  '2026-08-20T10:00:00.000Z',
  [
    finding('no-canonical', 'important', 'Нет canonical', SITE),
    finding('no-description', 'important', 'Нет мета-описания', SITE),
    finding('title-short', 'minor', 'Короткий title', SITE),
    finding('link-broken', 'critical', 'Битые внутренние ссылки', SITE + 'about'),
  ],
  [SITE, SITE + 'about'],
)

const firstMd = toMarkdown(first)
const firstHtml = toHtml(first)
const saved1 = saveRun(first, { md: firstMd, html: firstHtml })

assert.ok(firstMd.includes('# Аудит сайта'), 'в Markdown должен быть заголовок')
assert.ok(firstMd.includes('Нет canonical'), 'в Markdown должны быть находки')
assert.ok(firstMd.includes('Почему это важно'), 'в Markdown должно быть объяснение')
assert.ok(firstHtml.startsWith('<!doctype html>'), 'HTML должен быть полноценным документом')
assert.ok(firstHtml.includes('finding--critical'), 'критичная находка должна выделяться')
assert.ok(!firstHtml.includes('undefined'), 'в HTML не должно быть undefined')
assert.ok(existsSync(saved1.files.json), 'данные прогона должны сохраниться')
console.log('  ✓ Markdown и HTML собираются, прогон сохранён')

// ── второй прогон: часть починили, кое-что появилось ─────────────────────────
const second = run(
  '2026-08-27T10:00:00.000Z',
  [
    // no-canonical и title-short исправлены
    finding('no-description', 'important', 'Нет мета-описания', SITE),
    finding('link-broken', 'critical', 'Битые внутренние ссылки', SITE + 'about'),
    finding('multiple-h1', 'important', 'Несколько заголовков H1', SITE),
  ],
  [SITE, SITE + 'about', SITE + 'contacts'],
)

const previous = previousRun(SITE, second.finishedAt)
assert.ok(previous, 'предыдущий прогон должен находиться')
assert.equal(previous.finishedAt, first.finishedAt, 'должен браться самый свежий из прошлых')

const diff = compare(second, previous)
assert.deepEqual(
  diff.fixed.map((f) => f.id).sort(),
  ['no-canonical', 'title-short'],
  'исправленным считается то, что было и пропало',
)
assert.deepEqual(diff.appeared.map((f) => f.id), ['multiple-h1'], 'новое должно определяться')
assert.equal(diff.stayed.length, 2, 'остальное должно числиться как оставшееся')
assert.deepEqual(diff.skippedPages, [SITE + 'contacts'], 'новая страница в сравнение не идёт')
console.log('  ✓ сравнение с прошлым прогоном: 2 исправлено, 1 новая, 2 осталось')

const secondHtml = toHtml(second, diff)
const secondMd = toMarkdown(second, diff)
assert.ok(secondMd.includes('Что изменилось с прошлой проверки'), 'в Markdown должен быть раздел изменений')
assert.ok(secondHtml.includes('Что изменилось'), 'в HTML должен быть раздел изменений')

const saved2 = saveRun(second, { md: secondMd, html: secondHtml })

// ── печать в PDF ─────────────────────────────────────────────────────────────
const browser = findBrowser()
if (!browser) {
  console.log('  · браузер для печати не найден, PDF пропущен')
} else {
  console.log(`  · печатаю через ${path.basename(browser)}`)
  const pdfPath = `${saved2.base}.pdf`
  const result = await htmlToPdf(saved2.files.html, pdfPath)

  assert.ok(result.ok, `печать в PDF должна пройти: ${result.reason || ''}`)
  assert.ok(existsSync(pdfPath), 'файл PDF должен появиться')

  const size = statSync(pdfPath).size
  assert.ok(size > 5000, `PDF должен быть непустым, получилось ${size} байт`)
  console.log(`  ✓ PDF собран, ${Math.round(size / 1024)} КБ`)
}

console.log(`\n  Готово. Файлы в ${saved2.dir}\n`)
