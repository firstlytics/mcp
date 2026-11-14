# Changelog

## 1.0.0

The first release of the Firstlytics MCP server in public.

- The hosted server, `https://api.firstlytics.com/v1/mcp` (Streamable HTTP), with an organisation API key in
  `Authorization: Bearer fl_live_...`: 41 tools for reports, sites, goals, funnels, members, users, product
  analytics, Search Console and custom SQL.
- `@firstlytics/mcp`: the same server over stdio (`npx -y @firstlytics/mcp`, `FIRSTLYTICS_API_KEY`), for clients
  that start local servers, such as Claude Desktop. A bridge: its tools, instructions and answers are the
  hosted server's.
- Listed in the MCP Registry as `io.github.firstlytics/mcp`.
