# @metalift/mcp

Metalift MCP server for AI agents. Exposes scrape, crawl, map, and batch tools over stdio for Cursor, Claude Desktop, and other MCP clients.

## What is Metalift?

[Metalift Cloud](https://app.metalift.ai) is a hosted web context platform — scrape, crawl, and map sites into LLM-ready markdown for AI agents. This MCP server connects your AI client to the Metalift API.

## Get an API key

1. [Sign up for Metalift Cloud](https://app.metalift.ai/signup) and verify your email.
2. Complete onboarding and copy your API key from [Dashboard → API keys](https://app.metalift.ai/dashboard/keys).

New accounts receive **1,000 free credits/month**. Set `METALIFT_API_KEY` in your MCP config (see below). Do not commit keys to git.

## Install (after npm publish)

Add to your MCP client config:

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

For local development against a self-hosted API:

```json
{
  "mcpServers": {
    "metalift": {
      "command": "node",
      "args": ["/absolute/path/to/scraper-mcp/packages/mcp/dist/index.js"],
      "env": {
        "METALIFT_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `METALIFT_API_URL` | Metalift scrape API base URL (default: `http://localhost:8080`) |
| `METALIFT_API_KEY` | Bearer token for authenticated API access |

## Tools

| Tool | Description |
|------|-------------|
| `metalift_scrape` | Scrape a single URL |
| `metalift_batch_scrape` | Scrape multiple URLs |
| `metalift_crawl` | Crawl a website |
| `metalift_map` | Discover site URLs |
| `metalift_job_status` | Poll async jobs |
| `metalift_list_strategies` | List scrape strategies |
| `metalift_warm_session` | Warm WAF/retail cookies |
| `metalift_list_sessions` | List stored domain sessions |

## Local development

```bash
npm install
npm run build
npm run start
```

Verify tarball contents before publishing:

```bash
npm run pack:check   # from repo root
```
