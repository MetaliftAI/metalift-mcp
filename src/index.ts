#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MetaliftClient } from "./client.js";
import { runStartupCheck } from "./startup-check.js";
import { formatBatchScrapeResponse, formatScrapeResponse } from "./scrape-format.js";
import { normalizeScrapeArgs, FAST_SCRAPE_TIMEOUT_MS, type ScrapeArgs } from "./scrape-args.js";
import { buildWebSearchRequest, formatWebSearchResponse, WEB_SEARCH_RESULT_LIMIT } from "./web-search.js";
import {
  formatJobCreated,
  formatJobStatus,
  runWithProgress,
  waitForJob,
  type ToolHandlerExtra,
} from "./progress.js";

const COMPLIANCE_NOTICE =
  "You are solely responsible for complying with website terms, robots.txt, copyright, and data protection laws when using scraped content.";

const SERVER_INSTRUCTIONS = `Metalift provides web search and web scraping as separate, independently billed tools.

Web search (metalift_web_search):
- Returns SERP metadata only: title, url, snippet, engine, score — not full page content.
- Costs 2 credits per successful search (flat fee).
- Always returns up to ${WEB_SEARCH_RESULT_LIMIT} results.
- Do NOT auto-scrape all search results. Review snippets first, then call metalift_scrape only for URLs that need full content.

Scraping (metalift_scrape, metalift_batch_scrape):
- Fetches page content (markdown, html, text). Billed per URL (static=1, JS=5, premium=10+ credits).
- response_detail controls how much is returned (default compact):
  • compact — truncated markdown (~16k chars), minimal metadata, no links (best for LLM context)
  • standard — full markdown/text, metadata with up to 25 links
  • full — complete JSON payload including all links and html when requested
- Use compact unless you need full page text or link extraction.

Recommended agent workflow: metalift_web_search → answer from snippets when possible → metalift_scrape (compact) only when snippets are insufficient.

Session cookies (WAF / login-gated pages):
- Fingerprint mismatch exposes the scraper, not cookies themselves. Never replay cookies via static HTTP — that breaks TLS/JA3, Sec-CH-UA, and navigation context.
- Correct pattern: browser session → Playwright (real Chromium TLS + headers) → sticky proxy → target. Metalift does this automatically when session credentials are present.
- Preferred workflow:
  1. User opens the site in their browser and passes cookies (or full Playwright storage_state JSON).
  2. Call metalift_seed_session to store storage_state + user_agent for the domain (org-scoped, reused on later scrapes).
  3. Call metalift_scrape without cookies — seeded session auto-applies via unified browser session.
- One-shot: pass cookie_header or cookies on metalift_scrape — routes to Playwright + residential proxy (not static curl). Pair with headers.User-Agent from the same browser when provided.
- Do not invent cookie values. Only use what the user explicitly provides.
- metalift_warm_session (automated browser warmup, 15 credits) when manual seeding is not possible; often fails on strict WAFs.
- metalift_list_sessions shows stored domains.

For simple factual questions (versions, definitions, current events), prefer answering directly from search snippets. Do not scrape unless snippets are insufficient. Never paste raw scrape JSON to the user — summarize the answer in plain language.`;

const client = new MetaliftClient();

const server = new McpServer(
  {
    name: "metalift",
    version: "1.0.11",
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  }
);

server.registerTool(
  "metalift_scrape",
  {
    title: "Scrape URL",
    description: `Scrape a single URL into markdown, HTML, or text for LLM context. Separate from web search — use after metalift_web_search when full page content is needed. Default response_detail=compact (truncated markdown, no links). Use standard for full page text or full for complete JSON + all links. Default scrape path: fast direct static article extraction (strategy=article, render=static, proxy=direct, 10s timeout). Known e-commerce hosts (Amazon, Walmart, Target, eBay, Etsy, Wayfair, Nike, Best Buy, etc.) auto-route to the retail strategy (dynamic render + residential proxy, falls back to cloudflare) — just pass the URL, no need to set strategy for these. For full page HTML on static sites use strategy=download with formats=["html"] (1 credit, all tiers). strategy=raw and full-page HTML without download require Enterprise tier. For WAF, SPA, retail, or JS-heavy pages pass strategy=auto or a specific strategy (spa, cloudflare, retail). When the user provides browser session cookies (after a blocked scrape), pass cookie_header and matching User-Agent in headers. Response includes credits_charged based on actual usage (static=1, JS=5, premium=10+). ${COMPLIANCE_NOTICE}`,
    inputSchema: {
      url: z.string().url(),
      response_detail: z
        .enum(["compact", "standard", "full"])
        .optional()
        .describe(
          "Response depth: compact (default, ~16k chars, no links), standard (full markdown + capped links), full (complete JSON)."
        ),
      formats: z.array(z.enum(["markdown", "html", "text", "json"])).optional(),
      render: z.enum(["static", "dynamic", "auto"]).optional(),
      only_main_content: z.boolean().optional(),
      timeout_ms: z.number().optional(),
      wait_for: z.string().optional(),
      screenshot: z.boolean().optional(),
      proxy: z.enum(["auto", "direct", "residential", "datacenter"]).optional(),
      strategy: z
        .string()
        .optional()
        .describe(
          "Scrape strategy: auto, article, spa, cloudflare, authenticated, listing, retail, jsonld, download, raw, or comma-separated chain. Use download for full static HTML. See /v1/strategies for protection levels and credit estimates."
        ),
      cookies: z
        .record(z.string())
        .optional()
        .describe(
          "Session cookies (name→value). Routes through Playwright browser session + proxy — not static HTTP. Prefer metalift_seed_session for reuse."
        ),
      cookie_header: z
        .string()
        .max(16384)
        .optional()
        .describe(
          "Raw Cookie header from DevTools. Routes through Playwright + sticky proxy to preserve browser TLS fingerprint. Prefer metalift_seed_session with storage_state for repeat scrapes."
        ),
      headers: z
        .record(z.string())
        .optional()
        .describe(
          'Extra request headers. Pass User-Agent from the user\'s browser when using cookie_header so the session fingerprint matches.'
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async (args, extra) => {
    const normalized = normalizeScrapeArgs(args as ScrapeArgs);
    const detail = normalized.response_detail ?? "compact";
    const timeoutMs = (normalized.timeout_ms ?? FAST_SCRAPE_TIMEOUT_MS) + 30_000;
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Scraping ${normalized.url}`,
      () => client.scrape({ ...normalized, response_detail: detail }, { timeoutMs })
    );
    return {
      content: [
        {
          type: "text",
          text: formatScrapeResponse(result as Record<string, unknown>, detail),
        },
      ],
    };
  }
);

server.registerTool(
  "metalift_batch_scrape",
  {
    title: "Batch Scrape URLs",
    description: `Scrape multiple URLs in parallel. Response includes credits_charged (per-page usage billing). Pass async=true for background job; wait=true (default) blocks with progress until done. ${COMPLIANCE_NOTICE}`,
    inputSchema: {
      urls: z.array(z.string().url()).min(1).max(100),
      async: z.boolean().optional(),
      wait: z
        .boolean()
        .optional()
        .describe("When async=true, wait for completion with progress updates (default true)."),
      scrape_options: z
        .object({
          formats: z.array(z.enum(["markdown", "html", "text", "json"])).optional(),
          render: z.enum(["static", "dynamic", "auto"]).optional(),
          only_main_content: z.boolean().optional(),
          response_detail: z.enum(["compact", "standard", "full"]).optional(),
        })
        .optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args, extra) => {
    const scrapeOptions = args.scrape_options ?? {};
    const detail = scrapeOptions.response_detail ?? "compact";
    const wait = args.wait ?? true;
    const { wait: _wait, ...batchArgs } = args;
    const urlCount = batchArgs.urls.length;

    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      batchArgs.async ? `Starting batch scrape (${urlCount} URLs)` : `Batch scraping ${urlCount} URL(s)`,
      () =>
        client.batch(
          { ...batchArgs, scrape_options: { ...scrapeOptions, response_detail: detail } },
          { timeoutMs: batchArgs.async ? 30_000 : Math.max(120_000, urlCount * 60_000) }
        )
    );

    if (batchArgs.async && wait && typeof result.id === "string") {
      const job = await waitForJob(client, result.id, extra as ToolHandlerExtra | undefined);
      if (job.status === "failed") {
        throw new Error(typeof job.error === "string" ? job.error : "Batch job failed");
      }
      return {
        content: [
          {
            type: "text",
            text: formatBatchScrapeResponse(job, detail),
          },
        ],
      };
    }

    if (batchArgs.async && typeof result.id === "string") {
      return {
        content: [{ type: "text", text: formatJobCreated(result as Record<string, unknown>) }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: formatBatchScrapeResponse(result as Record<string, unknown>, detail),
        },
      ],
    };
  }
);

server.registerTool(
  "metalift_crawl",
  {
    title: "Crawl Website",
    description:
      "Crawl a website starting from a URL and return markdown for discovered pages. By default waits until complete with progress updates (wait=true). Set wait=false to return a job id immediately and poll metalift_job_status.",
    inputSchema: {
      url: z.string().url(),
      limit: z.number().optional(),
      max_depth: z.number().optional(),
      include_paths: z.array(z.string()).optional(),
      exclude_paths: z.array(z.string()).optional(),
      wait: z
        .boolean()
        .optional()
        .describe("Wait for crawl to finish with progress updates (default true)."),
    },
    annotations: { readOnlyHint: true },
  },
  async (args, extra) => {
    const wait = args.wait ?? true;
    const { wait: _wait, ...crawlArgs } = args;

    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Starting crawl of ${crawlArgs.url}`,
      () => client.crawl(crawlArgs)
    );

    if (!wait || typeof result.id !== "string") {
      return {
        content: [{ type: "text", text: formatJobCreated(result as Record<string, unknown>) }],
      };
    }

    const job = await waitForJob(client, result.id, extra as ToolHandlerExtra | undefined);
    if (job.status === "failed") {
      throw new Error(typeof job.error === "string" ? job.error : "Crawl job failed");
    }

    return {
      content: [
        {
          type: "text",
          text: formatBatchScrapeResponse(job, "compact"),
        },
      ],
    };
  }
);

server.registerTool(
  "metalift_map",
  {
    title: "Map Website URLs",
    description: "Discover URLs on a website without scraping full content.",
    inputSchema: {
      url: z.string().url(),
      limit: z.number().optional(),
      search: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Mapping URLs on ${args.url}`,
      () => client.map(args, { timeoutMs: 120_000 })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "metalift_web_search",
  {
    title: "Web Search",
    description: `Search the web and return up to ${WEB_SEARCH_RESULT_LIMIT} SERP results (title, url, snippet, engine, score). Costs 2 credits per search. Returns search snippets only — not page content. Answer simple questions from snippets; do not auto-scrape. Call metalift_scrape separately only when full page content is required.`,
    inputSchema: {
      query: z.string().min(1).max(512),
      categories: z.array(z.string()).optional(),
      language: z.string().max(16).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Searching: ${args.query}`,
      () => client.search(buildWebSearchRequest(args))
    );
    return {
      content: [{ type: "text", text: formatWebSearchResponse(result) }],
    };
  }
);

server.registerTool(
  "metalift_job_status",
  {
    title: "Get Job Status",
    description: "Poll async crawl or batch job status and results. Returns human-readable progress (pages completed, credits charged).",
    inputSchema: {
      job_id: z.string(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ job_id }, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Fetching job ${job_id.slice(0, 8)}…`,
      () => client.jobStatus(job_id)
    );
    return {
      content: [{ type: "text", text: formatJobStatus(result as Record<string, unknown>) }],
    };
  }
);

server.registerTool(
  "metalift_list_strategies",
  {
    title: "List Scrape Strategies",
    description: "List available scrape strategies with protection levels and credit estimates.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const result = await client.listStrategies();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "metalift_seed_session",
  {
    title: "Seed Domain Session",
    description:
      "Store browser session credentials for a domain (org-scoped). Prefer full Playwright storage_state JSON from the user's browser — preserves cookies + localStorage for fingerprint-coherent replay via unified browser session on later scrapes. Fallback: cookie_header + user_agent from DevTools.",
    inputSchema: {
      domain: z
        .string()
        .min(1)
        .max(253)
        .describe("Site hostname, e.g. actionpowertest.com or www.walmart.com"),
      storage_state: z
        .record(z.unknown())
        .optional()
        .describe("Playwright context.storageState() JSON — preferred over cookie_header alone"),
      cookie_header: z.string().max(16384).optional(),
      cookies: z.record(z.string()).optional(),
      user_agent: z
        .string()
        .max(512)
        .optional()
        .describe("User-Agent from the same browser session that issued the cookies"),
      ttl_hours: z.number().min(1).max(168).optional(),
    },
    annotations: { readOnlyHint: false },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Seeding session for ${args.domain}`,
      () => client.seedSession(args)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "metalift_warm_session",
  {
    title: "Warm Domain Session",
    description: "Visit a seed URL in a browser and store cookies for later scrapes (retail/WAF sites).",
    inputSchema: {
      url: z.string().url(),
      strategy: z.string().optional().describe("e.g. retail, cloudflare, authenticated"),
      domain: z.string().optional(),
      timeout_ms: z.number().optional(),
    },
    annotations: { readOnlyHint: false },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Warming session for ${args.url}`,
      () => client.warmSession(args, { timeoutMs: 120_000 })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "metalift_list_sessions",
  {
    title: "List Domain Sessions",
    description: "List seeded cookie sessions for the organization.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const result = await client.listSessions();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerResource(
  "config",
  "metalift://config",
  {
    title: "Metalift Configuration",
    description: "Current Metalift API connection settings",
    mimeType: "application/json",
  },
  async () => {
    const health = await client.health().catch(() => ({ status: "unreachable" }));
    return {
      contents: [
        {
          uri: "metalift://config",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              api_url: process.env.METALIFT_API_URL || "https://api.metalift.ai",
              health,
              tools: [
                "metalift_scrape",
                "metalift_batch_scrape",
                "metalift_crawl",
                "metalift_map",
                "metalift_web_search",
                "metalift_job_status",
                "metalift_list_strategies",
                "metalift_seed_session",
                "metalift_warm_session",
                "metalift_list_sessions",
              ],
              web_search: {
                credits_per_search: 2,
                result_limit: WEB_SEARCH_RESULT_LIMIT,
                decoupled_from_scrape: true,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerResource(
  "health",
  "metalift://health",
  {
    title: "Metalift Health",
    description: "API health and readiness",
    mimeType: "application/json",
  },
  async () => {
    const health = await client.health();
    return {
      contents: [
        {
          uri: "metalift://health",
          mimeType: "application/json",
          text: JSON.stringify(health, null, 2),
        },
      ],
    };
  }
);

server.registerPrompt(
  "summarize_page",
  {
    title: "Summarize Page",
    description: "Scrape a URL and summarize its main content",
    argsSchema: {
      url: z.string().url(),
    },
  },
  async ({ url }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Use metalift_scrape to fetch ${url}, then summarize the main content in 5 bullet points with source attribution.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "extract_schema",
  {
    title: "Extract Schema",
    description: "Scrape a page and extract structured data matching a schema",
    argsSchema: {
      url: z.string().url(),
      schema_description: z.string(),
    },
  },
  async ({ url, schema_description }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Use metalift_scrape on ${url}, then extract data matching this schema: ${schema_description}. Return valid JSON only.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "compare_pages",
  {
    title: "Compare Pages",
    description: "Scrape multiple pages and compare their content",
    argsSchema: {
      urls: z.string().describe("Comma-separated URLs"),
    },
  },
  async ({ urls }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Use metalift_batch_scrape on [${urls}], then compare key differences, similarities, and conflicting claims across the pages.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "research_topic",
  {
    title: "Research Topic",
    description:
      "Search the web for a topic, then scrape only the most relevant URLs (decoupled search + scrape workflow)",
    argsSchema: {
      query: z.string().describe("Search query"),
    },
  },
  async ({ query }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Research "${query}" using this decoupled workflow:
1. Call metalift_web_search with query "${query}" (2 credits, top 10 SERP snippets).
2. Review titles and snippets — do NOT scrape every result.
3. Call metalift_scrape only for the 1–3 URLs that need full page content.
4. Synthesize an answer citing sources.`,
        },
      },
    ],
  })
);

/**
 * Guard stdout: the stdio transport uses stdout for JSON-RPC framing. Any stray
 * console.log/info/warn or library write to stdout corrupts the stream and makes
 * Claude hang on `initialize` until it cancels (~60s). Redirect all console
 * output to stderr so only the MCP transport ever writes to stdout.
 */
function redirectConsoleToStderr() {
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ") + "\n",
    );
  };
  console.log = toStderr as typeof console.log;
  console.info = toStderr as typeof console.info;
  console.warn = toStderr as typeof console.warn;
  console.debug = toStderr as typeof console.debug;
}

async function main() {
  redirectConsoleToStderr();

  // Connect the transport FIRST so the SDK can answer `initialize` immediately.
  // No network/API work happens before this point.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Only after the handshake is live do we run the (fire-and-forget) API health
  // check. It writes to stderr and never blocks the transport.
  void runStartupCheck().catch((error) => {
    console.error("[metalift-mcp] Startup check error:", error);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
