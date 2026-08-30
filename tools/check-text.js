/**
 * Проверка текстов проекта на типографику и частые ошибки.
 *
 * Тексты Ревизора читают владельцы сайтов, а не разработчики, поэтому
 * небрежность в них заметна сразу и обесценивает отчёт. Этот скрипт ловит
 * то, что проверяется механически: тире вместо дефиса, лишние пробелы,
 * кавычки не той формы, многоточие из трёх точек.
 *
 * Запятые и обороты машина не проверит — их читают глазами.
 *
 *   npm run text
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Что проверяем: файл и как достать из него строки текста. */
const SOURCES = [
  ['src/checklist/checklist.json', pickChecklist],
  ['src/glossary.json', pickGlossary],
  ...readdirSync(path.join(root, 'src/rules'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => [`src/rules/${name}`, pickRules]),
]

const CHECKS = [
  {
    id: 'дефис вместо тире',
    test: /\s-\s/,
    hint: 'между словами ставится длинное тире со шпациями, а не дефис',
  },
  {
    id: 'тире без пробела',
    test: /\S—|—\S/,
    hint: 'тире отбивается пробелами с обеих сторон',
  },
  {
    id: 'двойной пробел',
    test: / {2}/,
    hint: 'лишний пробел',
  },
  {
    // Имена файлов вроде .git и .env начинаются с точки законно
    id: 'пробел перед знаком',
    test: /\s[,;:!?]|\s\.(?![a-zA-Z])/,
    hint: 'знак препинания примыкает к слову',
  },
  {
    // Кавычки внутри кода оставляем: lang="ru" пишется именно так
    id: 'прямые кавычки',
    test: /"/,
    skip: /=\s*"/,
    hint: 'в русском тексте кавычки «ёлочки»',
  },
  {
    id: 'многоточие точками',
    test: /\.\.\./,
    hint: 'многоточие — один знак …',
  },
  {
    // Двоеточие в og:title, site:домен и адресах — часть записи, а не пунктуация,
    // поэтому пропускаем его, когда слева стоит латиница
    id: 'нет пробела после знака',
    test: /[,;][^\s\d)»']|(?<![a-zA-Z]):(?![\s\d)/])/,
    hint: 'после знака препинания нужен пробел',
  },
]

// ── разбор файлов ────────────────────────────────────────────────────────────

function pickChecklist(data) {
  const lines = []
  for (const section of data.sections) {
    lines.push([`${section.id} · вступление`, section.intro])
    for (const check of section.checks) {
      lines.push([`${section.id} · ${check.title}`, check.why])
      lines.push([`${section.id} · ${check.title} · как`, check.how])
    }
  }
  return lines
}

function pickGlossary(data) {
  return data.groups.flatMap((group) => [
    [`${group.id} · вступление`, group.intro],
    ...group.terms.map((term) => [`${group.id} · ${term.term}`, term.text]),
  ])
}

function pickRules(data) {
  return data.rules.flatMap((rule) => [
    [`${rule.id} · формулировка`, rule.message],
    [`${rule.id} · почему`, rule.why],
    [`${rule.id} · что делать`, rule.fix],
  ])
}

// ── прогон ───────────────────────────────────────────────────────────────────

let total = 0
let checked = 0
const dashes = { long: 0, texts: 0 }

console.log('\n  Проверка текстов\n')

for (const [file, pick] of SOURCES) {
  const data = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
  const lines = pick(data)
  const problems = []

  for (const [where, text] of lines) {
    if (!text) continue
    checked += 1

    const long = (text.match(/—/g) || []).length
    if (long) {
      dashes.long += long
      dashes.texts += 1
    }

    for (const check of CHECKS) {
      if (!check.test.test(text)) continue
      if (check.skip && check.skip.test(text)) continue
      problems.push(`    ${where}\n      ${check.id}: ${check.hint}\n      ${cut(text)}`)
      total += 1
    }
  }

  const mark = problems.length ? `${problems.length}` : 'чисто'
  console.log(`  ${file.padEnd(34)} ${String(lines.length).padStart(4)} строк   ${mark}`)
  for (const problem of problems) console.log(problem)
}

console.log(`\n  Проверено строк: ${checked}. Замечаний: ${total}.`)
console.log(`  Длинных тире: ${dashes.long} в ${dashes.texts} строках.`)
console.log('  Тире ставится по правилу, а не для паузы: проверяйте глазами.\n')

if (total) process.exitCode = 1

function cut(text) {
  return text.length > 100 ? text.slice(0, 99) + '…' : text
}
