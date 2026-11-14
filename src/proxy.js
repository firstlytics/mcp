/**
 * The Firstlytics MCP server over stdio: a bridge to the hosted server (https://api.firstlytics.com/v1/mcp,
 * Streamable HTTP) for MCP clients that only start local servers. The tools, their descriptions and
 * their answers all come from the hosted server, so this package never falls behind it: it lists what
 * the hosted server lists and forwards every call with your API key.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/** The hosted Firstlytics MCP server. */
export const DEFAULT_URL = 'https://api.firstlytics.com/v1/mcp';

/** How long one tool call may take: reports over long periods and custom SQL can take a while. */
export const CALL_TIMEOUT_MS = 120_000;

/**
 * An API key as people paste it: with or without "Bearer ", with spaces around it.
 * @param {string | undefined} value
 */
export function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/^bearer\s+/i, '')
    .trim();
}

/** A clearer message for the errors people meet when they set it up. */
function explain(error, url) {
  const status = error?.code;
  if (status === 401) {
    return new Error(
      'Firstlytics refused the API key (401). Check FIRSTLYTICS_API_KEY: an organisation API key (fl_live_...) ' +
        'from Organization settings → API keys, not a password or a dashboard session.',
    );
  }
  if (status === 403) {
    return new Error(`Firstlytics refused the API key (403): ${error.message}`);
  }
  if (status === 429) {
    return new Error('Too many requests to Firstlytics (429): wait a minute and try again.');
  }
  if (typeof status === 'number' && status >= 400) {
    return new Error(`Firstlytics answered ${status} at ${url}: ${error.message}`);
  }
  const cause = error?.cause?.code || error?.code;
  if (cause === 'ENOTFOUND' || cause === 'ECONNREFUSED' || error?.name === 'TypeError') {
    return new Error(`Cannot reach ${url}: ${error?.cause?.message || error?.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Connects to the hosted server with an organisation API key.
 * @param {{ apiKey: string, url?: string, version?: string, fetch?: typeof fetch }} options
 * @returns {Promise<Client>}
 */
export async function connectRemote({ apiKey, url = DEFAULT_URL, version = '0.0.0', fetch: fetchImpl } = {}) {
  const key = normalizeKey(apiKey);
  if (!key) throw new Error('No API key: set FIRSTLYTICS_API_KEY to an organisation API key (fl_live_...).');
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${key}`, 'user-agent': `firstlytics-mcp/${version}` } },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const client = new Client({ name: 'firstlytics-mcp', version });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw explain(error, url);
  }
  return client;
}

/**
 * A local MCP server that answers with the hosted server's tools (and prompts and resources, if it has
 * any), forwarding every request through `client`.
 * @param {Client} client  connected with connectRemote()
 * @param {{ version?: string, url?: string }} [options]  `url` names the hosted server in error messages
 * @returns {Server}
 */
export function proxyServer(client, { version = '0.0.0', url = DEFAULT_URL } = {}) {
  const remote = client.getServerVersion();
  const capabilities = client.getServerCapabilities() ?? {};
  const server = new Server(
    { name: remote?.name ?? 'firstlytics', title: remote?.title ?? 'Firstlytics', version: remote?.version ?? version },
    {
      capabilities: {
        tools: {},
        ...(capabilities.prompts ? { prompts: {} } : {}),
        ...(capabilities.resources ? { resources: {} } : {}),
      },
      instructions: client.getInstructions(),
    },
  );
  const forward = async (call) => {
    try {
      return await call();
    } catch (error) {
      throw explain(error, url);
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, (request) => forward(() => client.listTools(request.params)));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    forward(() => client.callTool(request.params, undefined, { timeout: CALL_TIMEOUT_MS })),
  );
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (request) => forward(() => client.listPrompts(request.params)));
    server.setRequestHandler(GetPromptRequestSchema, (request) => forward(() => client.getPrompt(request.params)));
  }
  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (request) => forward(() => client.listResources(request.params)));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) =>
      forward(() => client.listResourceTemplates(request.params)),
    );
    server.setRequestHandler(ReadResourceRequestSchema, (request) => forward(() => client.readResource(request.params)));
  }
  return server;
}
