import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { handleListSources } from './tools/sources'
import { handleListItems, handleSearchItems, handleGetItem } from './tools/items'
import { handleRefreshSource } from './tools/refresh'
import { getSetting } from '../database/queries/settings'
import type {
  ListSourcesParams,
  ListItemsParams,
  SearchItemsParams,
  GetItemParams,
  RefreshSourceParams,
} from './types'

const DEFAULT_PORT = 33939

/** 工具定义（用于 tools/list 响应） */
const TOOL_DEFINITIONS = [
  {
    name: 'list_sources',
    description:
      '获取所有已配置的信息源列表，包括每个源的名称、类型、已存储的条目数量等。在查询条目之前，通常需要先调用此工具获取可用的信息源 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: '按启用状态过滤。true 只返回启用的源，false 只返回禁用的源。不传则返回全部。',
        },
      },
    },
  },
  {
    name: 'list_items',
    description:
      '分页查询信息流条目，按发布时间倒序排列（最新在前）。支持按信息源筛选、按时间范围筛选，以及通过游标翻页加载更多历史条目。这是最常用的查询工具。返回的 contentText 可能是截断的摘要，如需完整正文请用 get_item。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要查询的信息源 ID 列表。不传则查询所有 timeline 类型源的聚合流（group-chat 类型不包含在内）。',
        },
        limit: {
          type: 'number',
          description: '每页返回的条目数。默认 20，取值范围 1-100，超过 100 按 100 处理。',
        },
        cursor: {
          type: 'string',
          description: '翻页游标。值为上一次调用返回的 nextCursor。传入后返回发布时间早于该游标的条目。',
        },
        since: {
          type: 'string',
          description: '起始时间 (ISO 8601)，如 "2026-07-01T00:00:00Z"。只返回发布时间 >= 此时间的条目。',
        },
        until: {
          type: 'string',
          description: '截止时间 (ISO 8601)。只返回发布时间 <= 此时间的条目。',
        },
      },
    },
  },
  {
    name: 'search_items',
    description:
      '在信息流条目的正文中搜索关键词，返回匹配的条目列表。支持按信息源和时间范围筛选。搜索仅匹配正文文本，不匹配作者名。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词。在条目正文中进行模糊匹配（包含即命中）。',
        },
        sourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: '限定搜索范围为指定信息源。不传则搜索全部。',
        },
        limit: {
          type: 'number',
          description: '返回的最大条目数。默认 20，取值范围 1-100。',
        },
        since: {
          type: 'string',
          description: '起始时间 (ISO 8601)，只搜索此时间之后发布的条目。',
        },
        until: {
          type: 'string',
          description: '截止时间 (ISO 8601)，只搜索此时间之前发布的条目。',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_item',
    description:
      '根据条目 ID 获取单条条目的完整信息，包括正文、作者、媒体链接、元数据等。如果条目正文被截断（例如长微博只显示了前半部分），此工具会自动获取并返回完整正文。',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '条目唯一标识，来自 list_items 或 search_items 返回的 id 字段。',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'refresh_source',
    description:
      '主动刷新指定的信息源，从对应的信息平台（如微博、X）拉取最新条目并存储。刷新完成后，新条目立即可通过 list_items / search_items 查询到。适用于需要获取实时最新内容的场景。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要刷新的信息源 ID 列表。不传则刷新所有启用的信息源。',
        },
        timeout: {
          type: 'number',
          description: '单个源刷新的超时时间（秒）。默认 30，取值范围 5-120。',
        },
      },
    },
  },
]

/** 创建新的 MCP Server 实例并注册工具（每个请求创建一个，无状态模式） */
function createMcpServer(): Server {
  const srv = new Server(
    { name: 'feedflow', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'FeedFlow MCP Server：查询本地信息流数据，支持信息源列表、条目查询、关键词搜索、主动刷新等功能。',
    }
  )

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }))

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      let result: unknown
      switch (name) {
        case 'list_sources':
          result = handleListSources((args ?? {}) as ListSourcesParams)
          break
        case 'list_items':
          result = handleListItems((args ?? {}) as ListItemsParams)
          break
        case 'search_items':
          result = handleSearchItems((args ?? {}) as unknown as SearchItemsParams)
          break
        case 'get_item':
          result = await handleGetItem((args ?? {}) as unknown as GetItemParams)
          break
        case 'refresh_source':
          result = await handleRefreshSource((args ?? {}) as RefreshSourceParams)
          break
        default:
          throw new Error(`Unknown tool: ${name}`)
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      }
    }
  })

  return srv
}

/**
 * 启动 MCP Server（HTTP transport，监听 localhost）
 * 启动失败不影响 app 正常运行
 * 配置优先级：settings 表 > 环境变量 > 默认值
 */
export function startMcpServer(): void {
  try {
    // 检查是否启用（settings 表，默认启用）
    const enabled = getSetting('mcp.enabled')
    if (enabled === 'false') {
      console.log('[MCP] Server disabled in settings, skipping start')
      return
    }

    // 端口：settings > 环境变量 > 默认
    const portSetting = getSetting('mcp.port')
    const port = Number(portSetting || process.env.FEEDFLOW_MCP_PORT || DEFAULT_PORT)

    // 创建 HTTP server
    const httpServer = createServer(async (req, res) => {
      try {
        if (req.url === '/mcp') {
          // 每个请求创建新的 transport 和 server（无状态模式）
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          })
          transport.onerror = (err) => {
            console.error('[MCP] Transport error:', err)
          }

          const srv = createMcpServer()
          await srv.connect(transport)

          // 解析请求体（POST 请求）
          let parsedBody: unknown
          if (req.method === 'POST') {
            const chunks: Buffer[] = []
            for await (const chunk of req) {
              chunks.push(chunk)
            }
            const bodyStr = Buffer.concat(chunks).toString('utf-8')
            try {
              parsedBody = JSON.parse(bodyStr)
            } catch {
              parsedBody = bodyStr
            }
          }

          await transport.handleRequest(req, res, parsedBody)
        } else {
          res.statusCode = 404
          res.end('Not Found')
        }
      } catch (err) {
        console.error('[MCP] Request handler error:', err)
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      }
    })

    httpServer.on('error', (err) => {
      console.error(`[MCP] Server error: ${err.message}`)
    })

    httpServer.listen(port, '127.0.0.1', () => {
      console.log(`[MCP] Server listening on http://127.0.0.1:${port}/mcp`)
    })
  } catch (err) {
    // 启动失败不影响 app 运行
    console.error('[MCP] Failed to start MCP server:', err)
  }
}
