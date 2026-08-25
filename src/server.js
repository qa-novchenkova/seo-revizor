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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { checkUrl } from './checks/url.js'

const сервер = new McpServer({
  name: 'seo-revizor',
  version: '0.1.0',
})

сервер.registerTool(
  'check_url',
  {
    title: 'Проверка адреса',
    // Это описание читает модель. От того, насколько понятно здесь написано,
    // зависит, догадается ли она вызвать инструмент в нужный момент.
    description:
      'Проверяет один адрес: код ответа сервера, полную цепочку редиректов, ключевые ' +
      'заголовки и время ответа. Вызывай, когда нужно узнать, что сервер отдаёт по ' +
      'конкретному URL: жив ли адрес, куда он ведёт, сколько редиректов по дороге.',
    inputSchema: {
      url: z
        .string()
        .describe('Полный адрес со схемой, например https://example.com/catalog/'),
    },
  },
  async ({ url }) => {
    const результат = await checkUrl(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(результат, null, 2) }],
    }
  },
)

// stdio — это способ связи: клиент запускает сервер как обычную программу
// и разговаривает с ним через её ввод и вывод. Никаких портов и сети.
await сервер.connect(new StdioServerTransport())
console.error('Ревизор запущен, инструментов: 1')
