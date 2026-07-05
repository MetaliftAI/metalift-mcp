# @metalift/mcp

Metalift MCP server for AI agents. Exposes scrape, crawl, map, and batch tools over stdio for Cursor, Claude Desktop, and other MCP clients.

## What is Metalift?

[Metalift Cloud](https://app.metalift.ai) is a hosted web context platform — scrape, crawl, and map sites into LLM-ready markdown for AI agents. This MCP server connects your AI client to the Metalift API.

## Get an API key

1. [Sign up for Metalift Cloud](https://app.metalift.ai/signup) and verify your email.
2. Complete onboarding and copy your API key from [Dashboard → API keys](https://app.metalift.ai/dashboard/keys).

New accounts receive **1,000 free credits/month**. Set `METALIFT_API_KEY` in your MCP config (see below). Do not commit keys to git.

## Install

Published on npm as `@metalift/mcp`. Default config uses `npx`:

```json
{
  "mcpServers": {
    "metalift": {
      "command": "npx",
      "args": ["-y", "@metalift/mcp"],
      "env": {
        "METALIFT_API_URL": "https://api.metalift.ai",
        "METALIFT_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

**Claude Desktop:** paste the same JSON into `claude_desktop_config.json` (Settings → Developer → Edit Config). See [MCP setup — Claude Desktop](../../packages/platform-web/docs/mcp-setup.md#claude-desktop) and [examples/claude-mcp.json](../../examples/claude-mcp.json).

**Corporate Windows / SSL inspection:** if `npx` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, install locally and use `node` — see [examples/claude-mcp-local.json](../../examples/claude-mcp-local.json) / [cursor-mcp-local.json](../../examples/cursor-mcp-local.json) and [MCP setup troubleshooting](../../packages/platform-web/docs/mcp-setup.md#troubleshooting).

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Failed to acquire MessagePort` | Cursor IDE bug on Windows | Reload window, restart Cursor — [details](../../packages/platform-web/docs/mcp-setup.md#failed-to-acquire-messageport-cursor--vs-code) |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Corporate SSL inspection blocks npm | Local install + `node` path — [details](../../packages/platform-web/docs/mcp-setup.md#unable_to_verify_leaf_signature-npm--npx) |
| 401 / 402 at runtime | Auth or billing | Check API key and subscription |

Full guide: [packages/platform-web/docs/mcp-setup.md](../../packages/platform-web/docs/mcp-setup.md).

## Web search vs scrape

Search and scrape are **separate tools** with separate billing:

1. **`metalift_web_search`** — returns up to 10 search snippets (2 credits, English by default). Review titles and snippets first.
2. **`metalift_scrape`** — fetches page content for URLs you choose (1+ credits per URL). **Default `response_detail=compact`** (~16k chars, no link lists). Use `standard` for full articles or `full` for raw JSON with all links.

Do not auto-scrape every search result. See [Web search](../../packages/platform-web/docs/web-search.md) for agent workflow examples.

## Environment variables

| Variable | Description |
|----------|-------------|
| `METALIFT_API_URL` | Metalift scrape API base URL (default: `https://api.metalift.ai`) |
| `METALIFT_API_KEY` | Bearer token for authenticated API access |

## Tools

| Tool | Description |
|------|-------------|
| `metalift_scrape` | Scrape a single URL (default: fast direct static markdown, **`response_detail=compact`**; use `standard` / `full` for more) |
| `metalift_batch_scrape` | Scrape multiple URLs (same `response_detail`; default `compact`) |
| `metalift_crawl` | Crawl a website |
| `metalift_map` | Discover site URLs from page HTML links |
| `metalift_sitemap` | Fetch XML sitemap URLs (robots.txt / sitemap.xml) |
| `metalift_web_search` | Web search — top 10 SERP results (title, url, snippet). **2 credits** per search. Does not fetch page content; use `metalift_scrape` separately for URLs you need |
| `metalift_job_status` | Poll async jobs |
| `metalift_list_strategies` | List scrape strategies |
| `metalift_seed_session` | Store browser session cookies for a domain |
| `metalift_warm_session` | Warm WAF/retail cookies |
| `metalift_list_sessions` | List stored domain sessions |

