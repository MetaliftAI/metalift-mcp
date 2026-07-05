#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AGENT_GUIDE_EXTENDED,
  CONFIG_DECISION_TREE,
  SERVER_INSTRUCTIONS,
} from "./agent-preamble.js";
import { MetaliftClient } from "./client.js";
import { runStartupCheck } from "./startup-check.js";
import {
  formatBatchScrapeResponse,
  formatScrapeResponse,
  isScrapeFailure,
} from "./scrape-format.js";
import {
  computeScrapeHttpTimeout,
  describeAppliedDefaults,
  normalizeScrapeArgs,
  type ScrapeArgs,
} from "./scrape-args.js";
import { buildWebSearchRequest, formatWebSearchResponse, WEB_SEARCH_RESULT_LIMIT } from "./web-search.js";
import {
  formatJobCreated,
  formatJobStatus,
  runWithProgress,
  waitForJob,
  type ToolHandlerExtra,
} from "./progress.js";
import { mcpTextResult } from "./response-envelope.js";
import {
  formatMapResponse,
  formatSeedSessionResponse,
  formatSessionsListResponse,
  formatSitemapResponse,
  formatStrategiesResponse,
  formatWarmSessionResponse,
} from "./tool-formatters.js";

const COMPLIANCE_NOTICE =
  "You are solely responsible for complying with website terms, robots.txt, copyright, and data protection laws when using scraped content.";

const client = new MetaliftClient();

function normalizeBatchScrapeOptions(urls: string[], scrapeOptions: Omit<ScrapeArgs, "url">): Omit<ScrapeArgs, "url"> {
  const normalized = urls.map((url) => normalizeScrapeArgs({ url, ...scrapeOptions }));
  const first = normalized[0];
  const needsAutoStrategy = scrapeOptions.strategy === undefined && normalized.some((args) => args.strategy === "auto");
  const needsResidentialProxy = scrapeOptions.proxy === undefined && normalized.some((args) => args.proxy === "residential");
  const needsAutoRender = scrapeOptions.render === undefined && normalized.some((args) => args.render === "auto");
  const needsDynamicRender = scrapeOptions.render === undefined && normalized.some((args) => args.render === "dynamic");

  return {
    ...scrapeOptions,
    formats: scrapeOptions.formats ?? first?.formats,
    strategy: needsAutoStrategy ? "auto" : scrapeOptions.strategy ?? first?.strategy,
    render: needsAutoRender ? "auto" : needsDynamicRender ? "dynamic" : scrapeOptions.render ?? first?.render,
    proxy: needsResidentialProxy ? "residential" : scrapeOptions.proxy ?? first?.proxy,
    timeout_ms: scrapeOptions.timeout_ms ?? first?.timeout_ms,
    response_detail: scrapeOptions.response_detail ?? first?.response_detail,
  };
}

function batchHttpTimeoutMs(urls: string[], scrapeOptions: Omit<ScrapeArgs, "url">): number {
  const perUrlTimeout = Math.max(
    ...urls.map((url) => computeScrapeHttpTimeout({ url, ...scrapeOptions })),
  );
  return Math.max(120_000, perUrlTimeout * urls.length);
}

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
    description: `Scrape a single URL into markdown, HTML, or text. Default: fast static article path (1 credit, response_detail=compact). E-commerce hosts auto-route to retail/residential. Pass strategy=auto for WAF/SPA pages. Fetch metalift://agent-guide for session workflow. ${COMPLIANCE_NOTICE}`,
    inputSchema: {
      url: z.string().url().describe("Page URL to scrape"),
      response_detail: z
        .enum(["compact", "standard", "full"])
        .optional()
        .describe(
          "Response depth: compact (default, ~16k chars, no links), standard (full markdown + capped links), full (complete JSON)."
        ),
      formats: z
        .array(z.enum(["markdown", "html", "text", "json"]))
        .optional()
        .describe("Output formats; default markdown only"),
      render: z
        .enum(["static", "dynamic", "auto"])
        .optional()
        .describe("Render mode; default static for plain URLs"),
      only_main_content: z
        .boolean()
        .optional()
        .describe("Extract main article content only (default true)"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Per-attempt timeout in milliseconds"),
      wait_for: z.string().optional().describe("CSS selector to wait for before scraping"),
      screenshot: z.boolean().optional().describe("Capture page screenshot (adds cost)"),
      proxy: z
        .enum(["auto", "direct", "residential", "datacenter"])
        .optional()
        .describe("Proxy tier; default direct for static pages"),
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
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args, extra) => {
    const rawArgs = args as ScrapeArgs;
    const normalized = normalizeScrapeArgs(rawArgs);
    const appliedDefaults = describeAppliedDefaults(rawArgs, normalized);
    const detail = normalized.response_detail ?? "compact";
    const timeoutMs = computeScrapeHttpTimeout(normalized);
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Scraping ${normalized.url}`,
      () => client.scrape({ ...normalized, response_detail: detail }, { timeoutMs })
    );
    const formatted = formatScrapeResponse(result as Record<string, unknown>, detail, {
      appliedDefaults,
    });
    return mcpTextResult(formatted, isScrapeFailure(result as Record<string, unknown>));
  }
);

server.registerTool(
  "metalift_batch_scrape",
  {
    title: "Batch Scrape URLs",
    description: `Scrape up to 100 URLs in parallel (billed per URL). Default response_detail=compact. Use async=true for background jobs; wait=true blocks with progress. For JS-heavy pages set strategy=auto in scrape_options. ${COMPLIANCE_NOTICE}`,
    inputSchema: {
      urls: z.array(z.string().url()).min(1).max(100).describe("URLs to scrape in parallel"),
      async: z.boolean().optional().describe("Run as background job (returns job id)"),
      wait: z
        .boolean()
        .optional()
        .describe("When async=true, wait for completion with progress updates (default true)."),
      scrape_options: z
        .object({
          formats: z.array(z.enum(["markdown", "html", "text", "json"])).optional(),
          render: z.enum(["static", "dynamic", "auto"]).optional(),
          only_main_content: z.boolean().optional(),
          timeout_ms: z.number().optional(),
          wait_for: z.string().optional(),
          proxy: z.enum(["auto", "direct", "residential", "datacenter"]).optional(),
          strategy: z.string().optional(),
          response_detail: z.enum(["compact", "standard", "full"]).optional(),
        })
        .optional()
        .describe("Shared scrape options applied to every URL in the batch"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args, extra) => {
    const scrapeOptions = normalizeBatchScrapeOptions(args.urls, args.scrape_options ?? {});
    const detail = scrapeOptions.response_detail ?? "compact";
    const wait = args.wait ?? true;
    const { wait: _wait, ...batchArgs } = args;
    const urlCount = batchArgs.urls.length;
    const syncTimeoutMs = batchHttpTimeoutMs(batchArgs.urls, scrapeOptions);

    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      batchArgs.async ? `Starting batch scrape (${urlCount} URLs)` : `Batch scraping ${urlCount} URL(s)`,
      () =>
        client.batch(
          { ...batchArgs, scrape_options: { ...scrapeOptions, response_detail: detail } },
          { timeoutMs: batchArgs.async ? 30_000 : syncTimeoutMs }
        )
    );

    if (batchArgs.async && wait && typeof result.id === "string") {
      const job = await waitForJob(client, result.id, extra as ToolHandlerExtra | undefined, {
        timeoutMs: syncTimeoutMs,
      });
      if (job.status === "failed") {
        throw new Error(typeof job.error === "string" ? job.error : "Batch job failed");
      }
      return mcpTextResult(formatBatchScrapeResponse(job, detail));
    }

    if (batchArgs.async && typeof result.id === "string") {
      return mcpTextResult(formatJobCreated(result as Record<string, unknown>));
    }

    return mcpTextResult(formatBatchScrapeResponse(result as Record<string, unknown>, detail));
  }
);

server.registerTool(
  "metalift_crawl",
  {
    title: "Crawl Website",
    description:
      "Crawl a site from a seed URL and return markdown for discovered pages (1+ credits per page). Default wait=true blocks with progress; wait=false returns job id for metalift_job_status.",
    inputSchema: {
      url: z.string().url().describe("Seed URL to start crawling from"),
      limit: z.number().optional().describe("Maximum pages to crawl"),
      max_depth: z.number().optional().describe("Maximum link depth from seed URL"),
      include_paths: z.array(z.string()).optional().describe("Only crawl paths matching these prefixes"),
      exclude_paths: z.array(z.string()).optional().describe("Skip paths matching these prefixes"),
      wait: z
        .boolean()
        .optional()
        .describe("Wait for crawl to finish with progress updates (default true)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
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
      return mcpTextResult(formatJobCreated(result as Record<string, unknown>));
    }

    const job = await waitForJob(client, result.id, extra as ToolHandlerExtra | undefined);
    if (job.status === "failed") {
      throw new Error(typeof job.error === "string" ? job.error : "Crawl job failed");
    }

    return mcpTextResult(formatBatchScrapeResponse(job, "compact"));
  }
);

server.registerTool(
  "metalift_sitemap",
  {
    title: "Fetch Sitemap",
    description:
      "Fetch XML sitemap URLs for a site. Discovers sitemap locations from robots.txt (Sitemap: directives) or /sitemap.xml, follows sitemap indexes, and returns page URLs with optional lastmod/changefreq/priority. Costs 1 credit. Prefer this over metalift_map when you need the site's published URL list.",
    inputSchema: {
      url: z.string().url().describe("Site homepage or direct sitemap.xml URL"),
      limit: z.number().min(1).max(10000).optional(),
      search: z.string().optional().describe("Optional substring filter; matching URLs sort first"),
      same_origin: z.boolean().optional().describe("Only return URLs on the same origin (default true)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Fetching sitemap for ${args.url}`,
      () => client.sitemap(args, { timeoutMs: 120_000 })
    );
    return mcpTextResult(formatSitemapResponse(result as Record<string, unknown>));
  }
);

server.registerTool(
  "metalift_map",
  {
    title: "Map Website URLs",
    description:
      "Discover same-origin links by parsing HTML anchors on one page (1 credit). Fallback when metalift_sitemap is unavailable. Does not fetch full page content.",
    inputSchema: {
      url: z.string().url().describe("Page URL to extract links from"),
      limit: z.number().optional().describe("Maximum URLs to return"),
      search: z.string().optional().describe("Optional substring filter for URLs"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Mapping URLs on ${args.url}`,
      () => client.map(args, { timeoutMs: 120_000 })
    );
    return mcpTextResult(formatMapResponse(result as Record<string, unknown>));
  }
);

server.registerTool(
  "metalift_web_search",
  {
    title: "Web Search",
    description: `Search the web and return up to ${WEB_SEARCH_RESULT_LIMIT} SERP results (title, url, snippet, engine, score). Costs 2 credits per search. Returns search snippets only — not page content. Answer simple questions from snippets; do not auto-scrape. Call metalift_scrape separately only when full page content is required.`,
    inputSchema: {
      query: z.string().min(1).max(512).describe("Search query"),
      categories: z.array(z.string()).optional().describe("Optional search categories"),
      language: z.string().max(16).optional().describe("Result language (default en)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Searching: ${args.query}`,
      () => client.search(buildWebSearchRequest(args))
    );
    return mcpTextResult(formatWebSearchResponse(result));
  }
);

server.registerTool(
  "metalift_job_status",
  {
    title: "Get Job Status",
    description: "Poll async crawl or batch job status and results. Returns human-readable progress (pages completed, credits charged).",
    inputSchema: {
      job_id: z.string().describe("Job id from metalift_crawl or metalift_batch_scrape"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ job_id }, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Fetching job ${job_id.slice(0, 8)}…`,
      () => client.jobStatus(job_id)
    );
    return mcpTextResult(formatJobStatus(result as Record<string, unknown>));
  }
);

server.registerTool(
  "metalift_list_strategies",
  {
    title: "List Scrape Strategies",
    description: "List scrape strategies with protection levels and credit estimates. Use before scraping unknown protected sites.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const result = await client.listStrategies();
    return mcpTextResult(formatStrategiesResponse(result as unknown as Record<string, unknown>));
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
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Seeding session for ${args.domain}`,
      () => client.seedSession(args)
    );
    const formatted = formatSeedSessionResponse(result as unknown as Record<string, unknown>);
    return mcpTextResult(formatted, result.success === false);
  }
);

server.registerTool(
  "metalift_warm_session",
  {
    title: "Warm Domain Session",
    description:
      "Automated browser warmup to collect cookies for later scrapes (15 credits). Use when manual metalift_seed_session is not possible; often fails on strict WAFs.",
    inputSchema: {
      url: z.string().url().describe("Seed URL to visit in browser"),
      strategy: z.string().optional().describe("e.g. retail, cloudflare, authenticated"),
      proxy: z
        .enum(["auto", "direct", "residential", "datacenter"])
        .optional()
        .describe("Default auto. Use residential for WAF-heavy sites."),
      domain: z.string().optional().describe("Override domain for stored session"),
      timeout_ms: z.number().optional().describe("Browser warmup timeout in milliseconds"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async (args, extra) => {
    const result = await runWithProgress(
      extra as ToolHandlerExtra | undefined,
      `Warming session for ${args.url}`,
      () => client.warmSession(args, { timeoutMs: 120_000 })
    );
    const formatted = formatWarmSessionResponse(result as Record<string, unknown>);
    return mcpTextResult(formatted, result.success === false);
  }
);

server.registerTool(
  "metalift_list_sessions",
  {
    title: "List Domain Sessions",
    description: "List org-scoped browser sessions stored via metalift_seed_session.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const result = await client.listSessions();
    return mcpTextResult(formatSessionsListResponse(result as unknown as Record<string, unknown>));
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
                "metalift_sitemap",
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
              credits: {
                search: 2,
                sitemap: 1,
                map: 1,
                scrape_static: 1,
                scrape_js: 5,
                scrape_premium: 10,
                warm_session: 15,
              },
              decision_tree: CONFIG_DECISION_TREE,
              agent_guide_uri: "metalift://agent-guide",
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
  "agent-guide",
  "metalift://agent-guide",
  {
    title: "Metalift Agent Guide",
    description: "Extended workflow guidance for session handling, WAF sites, and tool selection",
    mimeType: "text/markdown",
  },
  async () => ({
    contents: [
      {
        uri: "metalift://agent-guide",
        mimeType: "text/markdown",
        text: AGENT_GUIDE_EXTENDED,
      },
    ],
  })
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
