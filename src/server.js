/**
 * MCP-сервер «Ревизор».
 *
 * Всё, что он делает: держит у себя список инструментов и умеет отвечать
 * на два вопроса — «какие у тебя есть инструменты» и «выполни вот этот».
 * Больше в протоколе ничего нет.
 *
 * ВАЖНО: общение идёт через стандартный ввод-вывод. Обычный console.log
 * пишет в тот же поток и ломает протокол. Для отладки — только console.error.
 */
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { checkUrl } from './checks/url.js'
import { checkMeta } from './checks/meta.js'
import { checkRobots } from './checks/robots.js'
import { checkSitemap } from './checks/sitemap.js'
import { checkLinks } from './checks/links.js'
import { checkMirrors } from './checks/mirrors.js'
import { checkSecurity } from './checks/security.js'
import { checkAnalytics } from './checks/analytics.js'
import { checkContent } from './checks/content.js'
import { checkSpeed } from './checks/speed.js'
import { allRules, rulesByArea } from './rules/index.js'

// McpServer — класс из SDK. Объект хранит список инструментов и знает,
// какой обработчик вызвать, когда придёт запрос на выполнение.
const server = new McpServer({ name: 'seo-revizor', version: '0.6.0' })

/**
 * Список зарегистрированных инструментов — то же самое, что сервер отдаёт
 * на запрос «какие у тебя есть инструменты», только без протокола вокруг.
 * Из него собирается страница проекта, чтобы описания не разъезжались с кодом.
 */
export const TOOLS = []

/**
 * Небольшая обёртка, чтобы не повторять одно и то же в каждом инструменте.
 * Отвечает за две вещи: упаковку результата в формат протокола и за то,
 * чтобы упавшая проверка вернула понятный текст, а не уронила сервер.
 */
function tool(name, meta, run) {
  TOOLS.push({ name, title: meta.title, description: meta.description })

  server.registerTool(name, meta, async (args) => {
    try {
      const result = await run(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Проверка «${name}» упала: ${error.message || error}` }],
      }
    }
  })
}

const urlArg = z.string().describe('Полный адрес со схемой, например https://example.com/catalog/')

tool(
  'check_url',
  {
    title: 'Проверка адреса',
    description:
      'Проверяет один адрес: код ответа сервера, полную цепочку редиректов, ключевые ' +
      'заголовки и время ответа. Вызывай, когда нужно узнать, что сервер отдаёт по ' +
      'конкретному URL: жив ли адрес, куда он ведёт, сколько редиректов по дороге.',
    inputSchema: { url: urlArg },
  },
  ({ url }) => checkUrl(url),
)

tool(
  'check_meta',
  {
    title: 'Мета-теги и заголовки страницы',
    description:
      'Скачивает страницу и разбирает её содержимое: title, описание, заголовки H1–H6 и их ' +
      'иерархию, canonical, мета-тег robots, разметку Open Graph, микроразметку Schema.org, ' +
      'атрибуты alt у изображений. Вызывай для проверки конкретной страницы на месте.',
    inputSchema: { url: urlArg },
  },
  ({ url }) => checkMeta(url),
)

tool(
  'check_robots',
  {
    title: 'Файл robots.txt',
    description:
      'Скачивает и разбирает robots.txt: группы правил, запреты, директивы Sitemap. ' +
      'Отдельно проверяет, не закрыт ли сайт от индексации целиком. ' +
      'Вызывай первым при аудите нового сайта: здесь находятся самые тяжёлые ошибки, ' +
      'а заодно выясняется адрес карты сайта.',
    inputSchema: {
      url: z.string().describe('Адрес сайта, например https://example.com/. Путь до robots.txt добавится сам'),
    },
  },
  ({ url }) => checkRobots(url),
)

tool(
  'check_sitemap',
  {
    title: 'Карта сайта',
    description:
      'Разбирает sitemap.xml и возвращает список адресов страниц. Понимает карту карт ' +
      '(sitemapindex) и заглядывает внутрь. Проверяет дубли, чужие домены, адреса ' +
      'с параметрами, наличие дат изменения. Отдельно возвращает поле sample — ' +
      'представительную выборку: по одной странице каждого типа (главная, раздел, ' +
      'карточка, статья). Для поштучной проверки бери адреса именно оттуда, ' +
      'а не первые из общего списка: иначе проверишь десять однотипных страниц.',
    inputSchema: {
      url: z.string().describe('Адрес сайта или прямой адрес карты. Если передан сайт, будет взят /sitemap.xml'),
      limit: z.number().optional().describe('Сколько адресов вернуть в общем списке, по умолчанию 50'),
      sampleSize: z.number().optional().describe('Размер представительной выборки, по умолчанию 8'),
    },
  },
  ({ url, limit, sampleSize }) => checkSitemap(url, { limit: limit ?? 50, sampleSize: sampleSize ?? 8 }),
)

tool(
  'check_links',
  {
    title: 'Внутренние ссылки',
    description:
      'Собирает ссылки со страницы и проверяет их: битые, ведущие на переадресацию, ' +
      'без текста, с неинформативным текстом вроде «подробнее», с атрибутом nofollow. ' +
      'Отдельно показывает структуру: какие разделы вообще видны в разметке. ' +
      'Вызывай, когда нужно понять связность сайта — например, если на главной ' +
      'не видно ссылок на каталог, и непонятно, беда это сайта или её просто рисуют скриптами.',
    inputSchema: {
      url: urlArg,
      depth: z.number().optional().describe('Глубина обхода: 1 — только эта страница, 2 — плюс страницы по её ссылкам. По умолчанию 1'),
    },
  },
  ({ url, depth }) => checkLinks(url, { depth: depth ?? 1 }),
)

tool(
  'check_mirrors',
  {
    title: 'Зеркала и дубли адресов',
    description:
      'Проверяет, не видит ли поисковик вместо одного сайта несколько копий: адрес с www ' +
      'и без, версия по http, технические дубли главной вроде /index.php, слэш на конце, ' +
      'параметры в адресе, а также отдаёт ли несуществующая страница честный код 404. ' +
      'Вызывай в начале аудита: пока сайт двоится, остальные правки почти бессмысленны.',
    inputSchema: { url: z.string().describe('Адрес сайта, например https://example.com/') },
  },
  ({ url }) => checkMirrors(url),
)

tool(
  'check_security',
  {
    title: 'Безопасность',
    description:
      'Смотрит срок и корректность сертификата, защитные заголовки, атрибуты cookie, ' +
      'смешанное содержимое, доступность служебных файлов вроде .git и .env, открытый ' +
      'список файлов в папках и показ подробностей ошибки на боевом сервере. ' +
      'Раздел, который в SEO-аудитах обычно пропускают, а находки там заметные.',
    inputSchema: { url: z.string().describe('Адрес сайта') },
  },
  ({ url }) => checkSecurity(url),
)

tool(
  'check_analytics',
  {
    title: 'Аналитика',
    description:
      'Ищет системы аналитики в разметке: Яндекс.Метрика, Google Analytics, Tag Manager ' +
      'и другие. Проверяет, не задвоен ли счётчик, не грузится ли синхронно и стоит ли он ' +
      'на других страницах тоже. Без счётчика нельзя ответить на вопрос «что сработало».',
    inputSchema: {
      url: z.string().describe('Адрес страницы, обычно главной'),
      alsoCheck: z.array(z.string()).optional().describe('Другие адреса, где тоже должен стоять счётчик'),
    },
  },
  ({ url, alsoCheck }) => checkAnalytics(url, { alsoCheck: alsoCheck ?? [] }),
)

tool(
  'check_content',
  {
    title: 'Контент и дубли',
    description:
      'Сравнивает несколько страниц между собой: одинаковые title и описания, повторяющийся ' +
      'текст, слишком короткие и пустые страницы, остатки демонстрационного текста, ' +
      'расхождения в телефонах. Единственная проверка, которой нужна не одна страница, ' +
      'а набор: дубли по определению видны только при сравнении. Передавай адреса ' +
      'из выборки, которую вернул check_sitemap, или из обхода ссылок.',
    inputSchema: {
      urls: z.array(z.string()).describe('Список адресов для сравнения, от двух до десяти'),
    },
  },
  ({ urls }) => checkContent(urls),
)

tool(
  'check_speed',
  {
    title: 'Скорость и Core Web Vitals',
    description:
      'Измеряет скорость через бесплатный сервис PageSpeed Insights: общая оценка, ' +
      'LCP, CLS, INP, время ответа сервера, а также что именно тормозит — блокирующие ' +
      'ресурсы, тяжёлые картинки, лишний код, отсутствие кеширования. ' +
      'Требует бесплатного ключа: без него честно скажет, что раздел пропущен.',
    inputSchema: {
      url: z.string().describe('Адрес страницы'),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Устройство, по умолчанию mobile'),
    },
  },
  ({ url, strategy }) => checkSpeed(url, { strategy: strategy ?? 'mobile' }),
)

tool(
  'list_rules',
  {
    title: 'Чек-лист проверок',
    description:
      'Возвращает список всех правил, по которым работает ревизор: идентификатор, ' +
      'важность, формулировку, объяснение «почему это плохо» и «что делать». ' +
      'Вызывай, когда нужно понять, что вообще умеет проверять инструмент, ' +
      'или объяснить пользователю смысл конкретной находки по её идентификатору.',
    inputSchema: {
      area: z.string().optional().describe('Отобрать по области, например «Индексация»'),
      severity: z.enum(['critical', 'important', 'minor']).optional().describe('Отобрать по важности'),
    },
  },
  ({ area, severity }) => {
    let rules = allRules()
    if (area) rules = rules.filter((rule) => rule.area.toLowerCase().includes(area.toLowerCase()))
    if (severity) rules = rules.filter((rule) => rule.severity === severity)

    return {
      total: rules.length,
      areas: rulesByArea().map((group) => ({ area: group.area, total: group.total })),
      rules: rules.map(({ file, ...rule }) => rule),
    }
  },
)

// Запускаемся только когда файл вызвали напрямую: `node src/server.js`.
// Если этот же файл просто читают ради списка TOOLS — сервер поднимать не нужно.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // stdio — это способ связи: клиент запускает сервер как обычную программу
  // и разговаривает с ним через её ввод и вывод. Никаких портов и сети.
  await server.connect(new StdioServerTransport())
  console.error(
    `Ревизор запущен, инструментов: ${TOOLS.length}, правил в чек-листе: ${allRules().length}`,
  )
}
