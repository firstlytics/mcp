# Firstlytics MCP server

[Firstlytics](https://firstlytics.com) is first-party web and product analytics: cookieless by default, with
the tracker on your own domain. This is its [Model Context Protocol](https://modelcontextprotocol.io) server:
Claude, Cursor and other AI assistants can answer questions such as "Where did last week's signups come from?"
with your data, and manage your goals and funnels.

There are two ways to connect, with the same tools:

- **Hosted**, at `https://api.firstlytics.com/v1/mcp` (Streamable HTTP), for clients that connect to remote
  servers: Claude Code, Cursor, VS Code, Windsurf and others. Nothing to install.
- **This package**, `@firstlytics/mcp`, over stdio, for clients that start local servers, such as Claude
  Desktop: `npx -y @firstlytics/mcp`. It is a bridge to the hosted server, so its tools are always the
  hosted server's.

Both sign in with an organisation API key.

## The API key

In Firstlytics, **Organization settings → API keys → New key**. The key's scopes decide what the assistant can
do, and a key limited to some sites sees only those:

| Scope | Tools |
| --- | --- |
| `stats:read` | reports (overview, timeseries, breakdowns, live, visits, events, errors, Web Vitals, journeys, goal conversions, funnel results) and custom SQL (`run_query`, `get_query_schema`: Scale plan) |
| `sites:read` | `list_sites`, site settings, funnels, annotations, segments |
| `sites:write` | creating, changing and deleting sites, goals and funnels |
| `members:read` | `list_members` |
| `members:write` | inviting people (not admins) and choosing which sites a member sees |

For an assistant that only reads reports, give it `stats:read` and `sites:read`. Add the write scopes only when
you want it to change things; it asks before deleting anything.

## Set it up

Replace `fl_live_...` with your key.

### Claude Code

```bash
claude mcp add --transport http firstlytics https://api.firstlytics.com/v1/mcp \
  --header "Authorization: Bearer fl_live_..."
```

### Claude Desktop

**Settings → Developer → Edit Config**, then in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "firstlytics": {
      "command": "npx",
      "args": ["-y", "@firstlytics/mcp"],
      "env": { "FIRSTLYTICS_API_KEY": "fl_live_..." }
    }
  }
}
```

Restart Claude Desktop after saving. It needs [Node.js](https://nodejs.org) 20 or later.

### Cursor

In `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "firstlytics": {
      "url": "https://api.firstlytics.com/v1/mcp",
      "headers": { "Authorization": "Bearer fl_live_..." }
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`; VS Code asks for the key the first time and keeps it:

```json
{
  "inputs": [
    { "type": "promptString", "id": "firstlytics-key", "description": "Firstlytics API key", "password": true }
  ],
  "servers": {
    "firstlytics": {
      "type": "http",
      "url": "https://api.firstlytics.com/v1/mcp",
      "headers": { "Authorization": "Bearer ${input:firstlytics-key}" }
    }
  }
}
```

### Other clients

A client that connects to remote servers: `https://api.firstlytics.com/v1/mcp`, Streamable HTTP, with the header
`Authorization: Bearer fl_live_...`.

A client that starts local servers: the command `npx -y @firstlytics/mcp`, with `FIRSTLYTICS_API_KEY` in its
environment.

## Tools

| Tool | What it does |
| --- | --- |
| `list_sites`, `get_site` | the sites the key sees, with visitors in the last 24 hours; one site's settings |
| `create_site`, `update_site_config`, `delete_site` | add a site, change its settings, delete it |
| `get_overview`, `get_overview_timeseries` | visitors, visits, page views, bounce rate, duration, over a period and over time |
| `get_breakdown` | top pages, sources, countries, devices, events, properties ... |
| `get_live_stats` | visitors now and in the last 30 minutes |
| `get_sessions`, `get_session` | visits, and every event of one visit |
| `get_events`, `get_event_names` | recent events; custom events with counts |
| `get_errors`, `get_web_vitals`, `get_journeys` | JavaScript errors, Core Web Vitals, common paths |
| `get_funnels`, `analyze_funnel`, `save_funnel`, `delete_funnel` | funnels and where visitors drop off |
| `get_goals`, `create_goal`, `update_goal`, `delete_goal` | goals and their conversions |
| `get_annotations`, `list_segments`, `apply_segment` | annotations, saved segments, a report with a segment |
| `list_members`, `add_member`, `update_member_site_access` | members, invitations, which sites a member sees |
| `get_query_schema`, `run_query` | custom SQL over the site's own data (Scale plan) |
| `get_search_console_status`, `get_search_console_data` | Search Console: clicks, impressions, CTR and position |
| `get_users`, `get_user`, `get_user_traits` | signed-in users, one user's profile across days, users by trait |
| `get_retention`, `get_active_users`, `get_feature_usage` | retention cohorts, DAU, WAU, MAU and stickiness, feature adoption |
| `delete_user` | erase a user for an erasure request (asks for `confirm_user_id`) |

Every tool does what the matching [API endpoint](https://firstlytics.com/docs/api/mcp/) does, with the same
checks. The user tools read data collected with cookies, so they need a site in a cookie mode; on a cookieless
site they find no users.

The full guide: [firstlytics.com/docs/settings/mcp-server](https://firstlytics.com/docs/settings/mcp-server/).

## Configuration

| Environment variable | |
| --- | --- |
| `FIRSTLYTICS_API_KEY` | an organisation API key (`fl_live_...`); required |
| `FIRSTLYTICS_MCP_URL` | another server than `https://api.firstlytics.com/v1/mcp` |

## Good to know

- The assistant reads what your visitors left in your data: page titles, paths, referrers, event names. Treat
  what it suggests from them as you would any text from the web.
- Delete a key in Organization settings when you no longer use it; the assistant loses access at once.
- The key is sent only to the server in `FIRSTLYTICS_MCP_URL`, over HTTPS. This package keeps nothing on disk.

## Development

```bash
npm install
npm test
```

The tests run the bridge against a stand-in for the hosted server, in memory and as the `firstlytics-mcp`
command over stdio.

Questions and bugs: [GitHub issues](https://github.com/firstlytics/mcp/issues) or
[support@firstlytics.com](mailto:support@firstlytics.com).

## License

[MIT](LICENSE), © FunFirst s.r.o.
