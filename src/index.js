#!/usr/bin/env node
// Entry point. Default: stdio transport. With --http: Streamable HTTP on /mcp (stateless).
//   reconstitution-calculator-mcp                 stdio
//   reconstitution-calculator-mcp --http          HTTP on 127.0.0.1:$PORT (default 8081)
//   reconstitution-calculator-mcp --http --port 3000 --host 0.0.0.0
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, NAME, VERSION } from './server.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const useHttp = process.argv.includes('--http') || process.env.TRANSPORT === 'http';

if (!useHttp) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
} else {
  const port = Number(arg('--port') ?? process.env.PORT ?? 8081);
  const host = arg('--host') ?? process.env.HOST ?? '127.0.0.1';
  const MAX_BODY = 1024 * 1024;

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: NAME, version: VERSION }));
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream and no sessions to delete.
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
      return;
    }
    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        return;
      }
      body += chunk;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
      return;
    }
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`${NAME} ${VERSION} listening on http://${host}:${port}/mcp`);
  });
}
