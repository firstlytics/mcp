#!/usr/bin/env node
/**
 * firstlytics-mcp: the Firstlytics MCP server over stdio, for MCP clients that start local servers
 * (Claude Desktop, and others). It connects to the hosted server with your organisation API key and
 * forwards everything (src/proxy.js).
 *
 *   FIRSTLYTICS_API_KEY=fl_live_... npx -y @firstlytics/mcp
 *
 * Environment:
 *   FIRSTLYTICS_API_KEY   an organisation API key (Organization settings → API keys); required
 *   FIRSTLYTICS_MCP_URL   another server than https://api.firstlytics.com/v1/mcp (optional)
 *
 * Standard output carries the protocol; messages go to standard error.
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectRemote, DEFAULT_URL, normalizeKey, proxyServer } from './proxy.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(version);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`firstlytics-mcp ${version}: the Firstlytics MCP server over stdio.

Usage (an MCP client starts it):
  FIRSTLYTICS_API_KEY=fl_live_... npx -y @firstlytics/mcp

Environment:
  FIRSTLYTICS_API_KEY   an organisation API key (Organization settings → API keys); required
  FIRSTLYTICS_MCP_URL   the server, default ${DEFAULT_URL}

Clients that connect to remote servers can use ${DEFAULT_URL} directly, with the header
Authorization: Bearer fl_live_... . Docs: https://firstlytics.com/docs/settings/mcp-server/`);
  process.exit(0);
}

const fail = (message) => {
  console.error(`firstlytics-mcp: ${message}`);
  process.exit(1);
};

const apiKey = normalizeKey(process.env.FIRSTLYTICS_API_KEY);
if (!apiKey) {
  fail(
    'FIRSTLYTICS_API_KEY is not set. Create an organisation API key in Firstlytics (Organization settings → API keys) ' +
      'and pass it in the environment of this server. Docs: https://firstlytics.com/docs/settings/mcp-server/',
  );
}
const url = (process.env.FIRSTLYTICS_MCP_URL || DEFAULT_URL).trim();

let client;
try {
  client = await connectRemote({ apiKey, url, version });
} catch (error) {
  fail(error.message);
}
const server = proxyServer(client, { version, url });
const transport = new StdioServerTransport();

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await Promise.allSettled([server.close(), client.close()]);
  process.exit(0);
};
transport.onclose = close;
process.stdin.on('end', close);
process.on('SIGINT', close);
process.on('SIGTERM', close);

await server.connect(transport);
console.error(`firstlytics-mcp ${version}: connected to ${url}`);
