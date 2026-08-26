/**
 * Проверка содержимого страницы: мета-теги, заголовки, canonical, alt у картинок.
 *
 * Это самый плотный по находкам инструмент: правки в title и H1 дают
 * заметный результат раньше всего остального.
 */
import * as cheerio from 'cheerio'
import { fetchText, describeError } from '../lib/http.js'
import { counted, FORMS } from '../lib/text.js'

/** Ориентиры длины. Взяты из практики, а не из стандарта: стандарта тут нет. */
const TITLE_MIN = 30
const TITLE_MAX = 70
const DESCRIPTION_MIN = 70
const DESCRIPTION_MAX = 180

export async function checkMeta(url, options = {}) {
  const { timeoutMs = 15000 } = options

  let page
  try {
    page = await fetchText(url, { timeoutMs })
  } catch (error) {
    return {
      url,
      ok: false,
      error: describeError(error, timeoutMs),
      notes: ['Страница не открылась, разбирать нечего.'],
    }
  }

  if (!page.ok) {
    return {
      url,
      ok: false,
      status: page.status,
      error: page.error || `Сервер ответил ${page.status}`,
      notes: [`Страница отдала ${page.status}. Мета-теги проверять не на чем.`],
    }
  }

  const $ = cheerio.load(page.body)
  const notes = []

  // ── тексты ────────────────────────────────────────────────────────────────
  const title = text($('head > title').first())
  const description = attr($('meta[name="description"]').first(), 'content')
  const robotsMeta = attr($('meta[name="robots"]').first(), 'content')
  const canonical = attr($('link[rel="canonical"]').first(), 'href')
  const lang = attr($('html').first(), 'lang')

  // ── заголовки ─────────────────────────────────────────────────────────────
  const headings = []
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push({ level: Number(el.tagName[1]), text: text($(el)) })
  })
  const h1 = headings.filter((h) => h.level === 1).map((h) => h.text)

  // ── Open Graph ────────────────────────────────────────────────────────────
  const og = {
    title: attr($('meta[property="og:title"]').first(), 'content'),
    description: attr($('meta[property="og:description"]').first(), 'content'),
    image: attr($('meta[property="og:image"]').first(), 'content'),
  }

  // ── изображения ───────────────────────────────────────────────────────────
  const images = $('img')
  const withoutAlt = []
  images.each((_, el) => {
    const alt = $(el).attr('alt')
    if (alt === undefined || alt.trim() === '') {
      const src = $(el).attr('src') || $(el).attr('data-src') || '(без src)'
      withoutAlt.push(src.slice(0, 120))
    }
  })

  // ── микроразметка ─────────────────────────────────────────────────────────
  const schemaTypes = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text())
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && item['@type']) schemaTypes.push(item['@type'])
      }
    } catch {
      notes.push('Блок микроразметки JSON-LD не разбирается: внутри некорректный JSON.')
    }
  })

  // ── замечания ─────────────────────────────────────────────────────────────
  if (!title) {
    notes.push('Нет тега title. Поисковик подставит в сниппет что угодно.')
  } else {
    if (title.length < TITLE_MIN) {
      notes.push(
        `Title короткий: ${counted(title.length, FORMS.symbol)}. В выдаче помещается около ${TITLE_MAX}, ` +
          'так что есть место уточнить: что именно, для кого, в каком городе.',
      )
    }
    if (title.length > TITLE_MAX) {
      notes.push(
        `Title длинный: ${counted(title.length, FORMS.symbol)}. В выдаче показывается около ${TITLE_MAX}, ` +
          'остальное обрежется многоточием — важное лучше ставить в начало.',
      )
    }
  }

  if (!description) {
    notes.push('Нет мета-описания. На позиции не влияет, но именно оно решает, кликнут по строке или нет.')
  } else {
    if (description.length < DESCRIPTION_MIN) {
      notes.push(
        `Описание короткое: ${counted(description.length, FORMS.symbol)}. Это текст под заголовком ` +
          `в результатах поиска, и именно он убеждает открыть страницу. Ориентир — от ${DESCRIPTION_MIN}.`,
      )
    }
    if (description.length > DESCRIPTION_MAX) {
      notes.push(
        `Описание длинное: ${counted(description.length, FORMS.symbol)}. В результатах поиска ` +
          `покажется около ${DESCRIPTION_MAX}, конец обрежется.`,
      )
    }
    if (title && description.trim() === title.trim()) {
      notes.push('Описание дословно повторяет title. Пользователь дважды читает одно и то же.')
    }
  }

  if (h1.length === 0) {
    notes.push('Нет заголовка H1. Это второй по важности сигнал о содержимом страницы после title.')
  }
  if (h1.length > 1) {
    notes.push(
      `На странице ${counted(h1.length, FORMS.heading)} уровня H1. Должен быть ровно один: ` +
        'он говорит поисковику, о чём страница. Несколько выглядят как попытка переспама.',
    )
  }
  if (h1.length === 1 && title && h1[0].trim() === title.trim()) {
    notes.push('H1 дословно совпадает с title. Упущена возможность охватить другие формулировки запроса.')
  }

  const skip = findHeadingSkip(headings)
  if (skip) {
    notes.push(`Пропуск в иерархии заголовков: после H${skip.from} идёт H${skip.to} («${skip.text}»).`)
  }

  if (!canonical) {
    notes.push('Нет canonical. Любые параметры в адресе начнут плодить дубли.')
  } else {
    const same = sameUrl(canonical, page.finalUrl)
    if (!same) {
      notes.push(`Canonical указывает на другой адрес: ${canonical}. Проверьте, так ли задумано.`)
    }
  }

  if (robotsMeta && /noindex/i.test(robotsMeta)) {
    notes.push(`В мета-теге robots стоит «${robotsMeta}» — страница исключена из поиска.`)
  }

  if (!lang) {
    notes.push('У тега html нет атрибута lang. Он нужен программам чтения с экрана и переводчикам.')
  }

  if (!og.title || !og.image) {
    notes.push('Неполная разметка Open Graph. Ссылка в мессенджере будет выглядеть голой строкой.')
  }

  if (withoutAlt.length) {
    notes.push(
      `Без атрибута alt ${counted(withoutAlt.length, FORMS.image)} из ${images.length}. ` +
        'Alt участвует в поиске по картинкам и читается вслух программами для незрячих.',
    )
  }

  if (!schemaTypes.length) {
    notes.push('Нет микроразметки Schema.org. Без неё не будет расширенного сниппета в выдаче.')
  }

  // Приложение с отрисовкой на стороне браузера: в исходном HTML пусто,
  // содержимое появляется только после выполнения скриптов. Поисковик
  // и этот инструмент видят одинаково — то есть почти ничего.
  const bodyText = text($('body'))
  const scripts = $('script[src]').length
  if (bodyText.length < 200 && headings.length === 0 && scripts > 0) {
    notes.push(
      'Страница собирается скриптами: в исходном HTML нет ни заголовков, ни текста. ' +
        'Часть роботов увидит пустой каркас. Для продвигаемых страниц нужен серверный ' +
        'рендеринг или предварительная сборка в статику.',
    )
  }

  return {
    url,
    ok: true,
    status: page.status,
    finalUrl: page.finalUrl,
    title: title ? { text: title, length: title.length } : null,
    description: description ? { text: description, length: description.length } : null,
    h1,
    headings: headings.slice(0, 40),
    canonical,
    robotsMeta,
    lang,
    og,
    images: {
      total: images.length,
      withoutAlt: withoutAlt.length,
      examples: withoutAlt.slice(0, 5),
    },
    schemaTypes,
    notes,
  }
}

/** Первый пропуск уровня: после H2 сразу H4 и подобное. */
function findHeadingSkip(headings) {
  let previous = 0
  for (const heading of headings) {
    if (previous && heading.level > previous + 1) {
      return { from: previous, to: heading.level, text: heading.text.slice(0, 60) }
    }
    previous = heading.level
  }
  return null
}

/** Сравнение адресов без учёта слэша на конце и регистра схемы. */
function sameUrl(a, b) {
  try {
    const normalize = (value) => {
      const parsed = new URL(value)
      return (parsed.origin + parsed.pathname).replace(/\/+$/, '').toLowerCase()
    }
    return normalize(a) === normalize(b)
  } catch {
    return false
  }
}

const text = (node) => (node.length ? node.text().trim().replace(/\s+/g, ' ') : '')
const attr = (node, name) => (node.length ? (node.attr(name) || '').trim() : '')
