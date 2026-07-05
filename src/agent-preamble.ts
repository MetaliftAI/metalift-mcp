export const METALIFT_AGENT_PREAMBLE = `Metalift provides decoupled web search and scraping tools with separate billing.

Workflow:
1. metalift_web_search for factual questions (2 credits, snippets only).
2. Answer from snippets when possible — do NOT auto-scrape all search results.
3. metalift_scrape only for 1–3 URLs that need full page content (default response_detail=compact).
4. Site discovery: metalift_sitemap first, then metalift_map, then metalift_crawl for bulk.

Defaults:
- Plain URLs use fast static article extraction (1 credit, compact markdown).
- E-commerce hosts auto-route to strategy=auto with residential proxy (~5–10 credits).
- Unknown JS-heavy dashboards/SPAs should use strategy=auto or strategy=spa,cloudflare.
- Do not set wait_for=networkidle for SPA scrapes; only use wait_for for real CSS selectors.
- Session cookies require metalift_seed_session — never invent cookie values.

Always summarize results for the user in plain language. Never paste raw scrape JSON.`;

export const SERVER_INSTRUCTIONS = METALIFT_AGENT_PREAMBLE;

export const AGENT_GUIDE_EXTENDED = `# Metalift agent guide

## Tool selection

| Goal | Tool | Credits |
|------|------|---------|
| Answer a factual question | metalift_web_search | 2 |
| Read one page | metalift_scrape | 1–10+ |
| Compare several pages | metalift_batch_scrape | per URL |
| List site URLs | metalift_sitemap (preferred) or metalift_map | 1 each |
| Bulk scrape a site | metalift_crawl | 1+ per page |
| Check async job | metalift_job_status | — |
| Pick scrape strategy | metalift_list_strategies | — |

## response_detail

- compact (default): ~16k chars, no link lists — best for LLM context
- standard: full markdown + capped links
- full: complete JSON for debugging

## Session / WAF workflow

1. User opens site in browser and provides cookies or Playwright storage_state JSON.
2. metalift_seed_session stores credentials org-scoped for the domain.
3. metalift_scrape without cookie args — seeded session auto-applies.

One-shot: pass cookie_header + matching User-Agent on metalift_scrape (Playwright path, not static HTTP).

metalift_warm_session (15 credits) when manual seeding is not possible — often fails on strict WAFs.

Never replay cookies via static HTTP — that breaks TLS/JA3 fingerprinting.

## MCP prompts

- research_topic — search → selective scrape
- summarize_page — scrape + bullet summary
- extract_schema — scrape + structured JSON extraction
- compare_pages — batch scrape + comparison

## Compliance

You are solely responsible for complying with website terms, robots.txt, copyright, and data protection laws when using scraped content.
`;

export const CONFIG_DECISION_TREE = {
  factual_question: "metalift_web_search → answer from snippets",
  need_full_page: "metalift_scrape with response_detail=compact",
  site_url_list: "metalift_sitemap → filter → metalift_scrape selected URLs",
  no_sitemap: "metalift_map → metalift_scrape selected URLs",
  bulk_scrape: "metalift_crawl or metalift_batch_scrape",
  blocked_scrape: "metalift_seed_session with user cookies → metalift_scrape",
  spa_timeout: "strategy=auto or strategy=spa,cloudflare; avoid wait_for=networkidle",
  retail_waf: "strategy=retail or metalift_warm_session",
};
