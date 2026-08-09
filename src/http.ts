import http from 'node:http';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { GarminClient } from './client';
import { createGarminServer } from './server';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/health';

function isAuthorized(req: http.IncomingMessage, authToken: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
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

async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  client: GarminClient,
): Promise<void> {
  const server = createGarminServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      sendJsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
}

export function startHttpServer(client: GarminClient, port: number): void {
  const authToken = process.env.MCP_AUTH_TOKEN;

  const server = http.createServer(async (req, res) => {
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

    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

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
  });

  server.listen(port, '0.0.0.0', () => {
    console.error(`Garmin Connect MCP server listening on port ${port} (streamable HTTP at ${MCP_PATH})`);
    if (!authToken) {
      console.error('Warning: MCP_AUTH_TOKEN is not set — the /mcp endpoint accepts unauthenticated requests');
    }
  });
}
