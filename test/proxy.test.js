/**
 * The bridge against a stand-in for the hosted server, built as the real one is: the MCP SDK's
 * Streamable HTTP transport, stateless, JSON responses, an organisation API key in Authorization.
 */
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { connectRemote, normalizeKey, proxyServer } from '../src/proxy.js';

const KEY = 'fl_live_test_0123456789';
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const INSTRUCTIONS = 'Firstlytics: start with list_sites for the site ids the other tools take.';

/** The hosted server's stand-in: three tools, one of which refuses. */
function hosted() {
  const server = new McpServer({ name: 'firstlytics', version: '9.9.9' }, { instructions: INSTRUCTIONS });
  server.registerTool('list_sites', { description: 'The sites the key sees.', inputSchema: {} }, async () => ({
    content: [{ type: 'text', text: JSON.stringify({ data: [{ id: 'site_1', domain: 'example.com' }] }) }],
  }));
  server.registerTool(
    'get_overview',
    { description: 'Visitors, visits, page views over a period.', inputSchema: { site_id: z.string(), period: z.string().optional() } },
    async ({ site_id, period }) => ({ content: [{ type: 'text', text: `overview of ${site_id} for ${period ?? '30d'}` }] }),
  );
  server.registerTool('delete_site', { description: 'Deletes a site.', inputSchema: { site_id: z.string() } }, async () => {
    throw new Error('forbidden: this key does not have sites:write');
  });
  return server;
}

let http;
let url;
const requests = [];

before(async () => {
  http = createServer(async (req, res) => {
    requests.push({ method: req.method, authorization: req.headers.authorization, userAgent: req.headers['user-agent'] });
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="firstlytics"' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Send an organisation API key' }, id: null }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const server = hosted();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${http.address().port}/v1/mcp`;
});

after(() => new Promise((resolve) => http.close(resolve)));

/** A client of the local bridge, in memory. */
async function bridged() {
  const remote = await connectRemote({ apiKey: KEY, url, version: '1.2.3' });
  const server = proxyServer(remote, { version: '1.2.3', url });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    close: async () => {
      await client.close();
      await remote.close();
    },
  };
}

describe('normalizeKey', () => {
  test('takes a key as people paste it', () => {
    assert.equal(normalizeKey('  fl_live_abc  '), 'fl_live_abc');
    assert.equal(normalizeKey('Bearer fl_live_abc'), 'fl_live_abc');
    assert.equal(normalizeKey('bearer   fl_live_abc '), 'fl_live_abc');
    assert.equal(normalizeKey(undefined), '');
  });
});

describe('the bridge', () => {
  test("lists the hosted server's tools, with its name and instructions", async () => {
    const { client, close } = await bridged();
    try {
      assert.equal(client.getServerVersion().name, 'firstlytics');
      assert.equal(client.getServerVersion().version, '9.9.9');
      assert.equal(client.getInstructions(), INSTRUCTIONS);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ['list_sites', 'get_overview', 'delete_site']);
      const overview = tools.find((t) => t.name === 'get_overview');
      assert.equal(overview.description, 'Visitors, visits, page views over a period.');
      assert.deepEqual(overview.inputSchema.required, ['site_id']);
    } finally {
      await close();
    }
  });

  test('forwards a call with its arguments and returns the answer', async () => {
    const { client, close } = await bridged();
    try {
      const result = await client.callTool({ name: 'get_overview', arguments: { site_id: 'site_1', period: '7d' } });
      assert.deepEqual(result.content, [{ type: 'text', text: 'overview of site_1 for 7d' }]);
      assert.notEqual(result.isError, true);
    } finally {
      await close();
    }
  });

  test("passes a tool's error on as it is, for the assistant to read", async () => {
    const { client, close } = await bridged();
    try {
      const result = await client.callTool({ name: 'delete_site', arguments: { site_id: 'site_1' } });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /sites:write/);
    } finally {
      await close();
    }
  });

  test('sends the API key and its own user agent', async () => {
    requests.length = 0;
    const { client, close } = await bridged();
    try {
      await client.listTools();
    } finally {
      await close();
    }
    const posts = requests.filter((r) => r.method === 'POST');
    assert.ok(posts.length >= 2);
    for (const r of posts) {
      assert.equal(r.authorization, `Bearer ${KEY}`);
      assert.equal(r.userAgent, 'firstlytics-mcp/1.2.3');
    }
  });

  test('says when the key is refused', async () => {
    await assert.rejects(connectRemote({ apiKey: 'fl_live_wrong', url }), /refused the API key \(401\)/);
  });

  test('asks for a key when there is none', async () => {
    await assert.rejects(connectRemote({ apiKey: '  ', url }), /FIRSTLYTICS_API_KEY/);
  });
});

describe('firstlytics-mcp, the command', () => {
  test('serves the tools over stdio', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI],
      env: { PATH: process.env.PATH, FIRSTLYTICS_API_KEY: ` Bearer ${KEY} `, FIRSTLYTICS_MCP_URL: url },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 3);
      const result = await client.callTool({ name: 'list_sites', arguments: {} });
      assert.match(result.content[0].text, /example\.com/);
    } finally {
      await client.close();
    }
  });

  test('stops with a message without a key', () => {
    const run = spawnSync(process.execPath, [CLI], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /FIRSTLYTICS_API_KEY is not set/);
    assert.equal(run.stdout, '');
  });

  test('stops with a message when the key is refused', async () => {
    // Not spawnSync: the stand-in server runs in this process and must answer meanwhile.
    const run = await promisify(execFile)(process.execPath, [CLI], {
      env: { PATH: process.env.PATH, FIRSTLYTICS_API_KEY: 'fl_live_wrong', FIRSTLYTICS_MCP_URL: url },
      timeout: 20_000,
    }).catch((error) => error);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /refused the API key \(401\)/);
  });

  test('prints its version and help', () => {
    const version = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.match(help.stdout, /FIRSTLYTICS_API_KEY/);
  });
});
