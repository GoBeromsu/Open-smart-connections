import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';

import type SmartConnectionsPlugin from '../main';
import type { JsonRpcRequest, JsonRpcResponse } from '../types/mcp';
import { dispatchMcpRequest } from '../domain/mcp-dispatch';
import { PluginMcpContext } from './mcp-plugin-context';

function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser MCP clients (curl, SDK) omit Origin — allow them
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

const MAX_BODY_BYTES = 1 * 1024 * 1024;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req as AsyncIterable<string | Buffer>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function writeJson(res: ServerResponse, statusCode: number, body: JsonRpcResponse | JsonRpcResponse[] | Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function closeServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class OpenConnectionsMcpServer {
  private server: HttpServer | null = null;
  private currentPort: number | null = null;
  private readonly ctx: PluginMcpContext;

  constructor(private readonly plugin: SmartConnectionsPlugin) {
    this.ctx = new PluginMcpContext(plugin);
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  get endpointUrl(): string {
    const port = this.currentPort ?? this.plugin.settings.mcp.port;
    return `http://127.0.0.1:${port}/mcp`;
  }

  async syncWithSettings(): Promise<void> {
    if (this.plugin.settings.mcp.enabled) {
      await this.start();
    } else {
      await this.stop();
    }
  }

  async start(): Promise<void> {
    const requestedPort = this.plugin.settings.mcp.port;
    if (this.server && this.currentPort === requestedPort) return;
    if (this.server) {
      await this.stop(false);
    }

    const server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.server = server;
    this.currentPort = requestedPort;
    this.plugin.logger.info(`[MCP] Server listening at ${this.endpointUrl}`);
    this.plugin.notices?.show('mcp_server_started', { url: this.endpointUrl }, { timeout: 5000 });
  }

  async stop(showNotice = true): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.currentPort = null;
    await closeServer(server);
    this.plugin.logger.info('[MCP] Server stopped');
    if (showNotice) {
      this.plugin.notices?.show('mcp_server_stopped');
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    res.setHeader('Access-Control-Allow-Origin', origin ?? 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (!isAllowedOrigin(origin)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.url !== '/mcp') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    if (req.method === 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST, OPTIONS');
      res.end('Use POST /mcp');
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST, OPTIONS');
      res.end('Method not allowed');
      return;
    }

    try {
      const body = await readJsonBody(req);
      const requests = Array.isArray(body) ? body : [body];
      const responses: JsonRpcResponse[] = [];

      for (const candidate of requests) {
        const request = candidate as JsonRpcRequest;
        if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
          responses.push({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Request' },
          });
          continue;
        }

        const response = await dispatchMcpRequest(this.ctx, request, this.endpointUrl);
        if (response) responses.push(response);
      }

      if (responses.length === 0) {
        res.statusCode = 202;
        res.end();
        return;
      }

      res.setHeader('MCP-Protocol-Version', String(req.headers['mcp-protocol-version'] || '2025-03-26'));
      writeJson(res, 200, Array.isArray(body) ? responses : responses[0]!);
    } catch (error) {
      this.plugin.logger.warn('[MCP] HTTP request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      writeJson(res, 500, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      });
    }
  }
}
