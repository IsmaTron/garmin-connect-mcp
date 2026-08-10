import http from 'node:http';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { GarminClient } from './client';
import { createGarminServer } from './server';
import { formatError } from './utils';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/health';
const BEARER_REGEX = /^Bearer[ \t]+(\S+)[ \t]*$/i;

function isAuthorized(req: http.IncomingMessage, authToken: string): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const match = BEARER_REGEX.exec(header);
  if (!match) return false;
  const provided = Buffer.from(match[1]!);
  const expected = Buffer.from(authToken);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendJsonRpcError(res: http.ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function getPathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  client: GarminClient,
): Promise<void> {
  const server = createGarminServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close().catch((error) => console.error('Error closing transport:', formatError(error)));
    server.close().catch((error) => console.error('Error closing server:', formatError(error)));
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling MCP request:', formatError(error));
    if (!res.headersSent) {
      sendJsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
}

export function startHttpServer(client: GarminClient, port: number): void {
  const authToken = process.env.MCP_AUTH_TOKEN;

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id',
      );

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const pathname = getPathname(req.url);

      if (pathname === HEALTH_PATH) {
        sendJson(res, 200, { status: 'ok', server: 'garmin-connect-mcp' });
        return;
      }

      if (pathname !== MCP_PATH) {
        sendJsonRpcError(res, 404, -32001, 'Not found');
        return;
      }

      if (authToken && !isAuthorized(req, authToken)) {
        sendJsonRpcError(res, 401, -32001, 'Unauthorized: missing or invalid Bearer token');
        return;
      }

      if (req.method !== 'POST') {
        sendJsonRpcError(res, 405, -32000, 'Method not allowed');
        return;
      }

      await handleMcpRequest(req, res, client);
    } catch (error) {
      console.error('Unhandled error in HTTP handler:', formatError(error));
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal server error');
      }
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.error(`Garmin Connect MCP server listening on port ${port} (streamable HTTP at ${MCP_PATH})`);
    if (!authToken) {
      console.error('Warning: MCP_AUTH_TOKEN is not set — the /mcp endpoint accepts unauthenticated requests');
    }
  });
}
