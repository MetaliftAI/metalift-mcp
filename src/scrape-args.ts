export type ScrapeFormat = "markdown" | "html" | "text" | "json";
export type ScrapeRender = "static" | "dynamic" | "auto";
export type ScrapeProxy = "auto" | "direct" | "residential" | "datacenter";
export type ScrapeResponseDetail = "compact" | "standard" | "full";

export interface ScrapeArgs {
  url: string;
  formats?: ScrapeFormat[];
  render?: ScrapeRender;
  only_main_content?: boolean;
  timeout_ms?: number;
  wait_for?: string;
  screenshot?: boolean;
  proxy?: ScrapeProxy;
  strategy?: string;
  cookies?: Record<string, string>;
  cookie_header?: string;
  headers?: Record<string, string>;
  response_detail?: ScrapeResponseDetail;
}

/** Default timeout for the fast direct static markdown path. */
export const FAST_SCRAPE_TIMEOUT_MS = 10_000;
export const DEFAULT_SCRAPE_TIMEOUT_MS = 30_000;
const BROWSER_HTTP_TIMEOUT_FLOOR_MS = 120_000;

const STRATEGY_FALLBACK_ATTEMPTS: Readonly<Record<string, number>> = {
  article: 2,
  spa: 2,
  retail: 2,
  authenticated: 2,
  auto: 3,
};

const BROWSER_STRATEGIES = new Set(["auto", "spa", "cloudflare", "retail", "authenticated", "listing"]);

function wantsFullPageHtml(args: ScrapeArgs): boolean {
  return args.formats?.includes("html") === true && args.only_main_content === false;
}

function shouldAutoDownload(args: ScrapeArgs): boolean {
  if (!wantsFullPageHtml(args)) {
    return false;
  }
  const primary = (args.strategy ?? "auto").split(",")[0]?.trim().toLowerCase();
  if (primary === "raw" || primary === "download") {
    return false;
  }
  if (primary && primary !== "auto" && primary !== "article") {
    return false;
  }
  return true;
}

function isMarkdownOnlyFormats(formats: ScrapeFormat[] | undefined): boolean {
  return formats === undefined || (formats.length === 1 && formats[0] === "markdown");
}

function primaryStrategy(strategy: string | undefined): string | undefined {
  return strategy?.split(",")[0]?.trim().toLowerCase() || undefined;
}

function strategyChainLength(strategy: string | undefined): number {
  if (!strategy) {
    return 1;
  }
  const names = strategy
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (names.length > 1) {
    return names.length;
  }
  const primary = names[0]?.toLowerCase();
  return primary ? STRATEGY_FALLBACK_ATTEMPTS[primary] ?? 1 : 1;
}

function usesBrowserPath(args: ScrapeArgs): boolean {
  const primary = primaryStrategy(args.strategy);
  return (
    args.render === "dynamic" ||
    args.render === "auto" ||
    args.screenshot === true ||
    (primary !== undefined && BROWSER_STRATEGIES.has(primary))
  );
}

export function computeScrapeHttpTimeout(args: ScrapeArgs): number {
  const perAttemptMs = args.timeout_ms ?? FAST_SCRAPE_TIMEOUT_MS;
  const chainAttempts = strategyChainLength(args.strategy);
  const timeoutMs = perAttemptMs * chainAttempts + 30_000;
  if (usesBrowserPath(args)) {
    return Math.max(BROWSER_HTTP_TIMEOUT_FLOOR_MS, timeoutMs);
  }
  return timeoutMs;
}

/**
 * Known e-commerce hosts that are protected by WAFs / bot detection and serve
 * JS-rendered storefronts. The fast direct-static article path returns empty or
 * bot-wall content for these, so we must route them through `auto` (which the
 * API resolves to the `retail` strategy with a residential proxy).
 */
const ECOMMERCE_HOST_SUFFIXES: readonly string[] = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.de",
  "amazon.fr",
  "amazon.co.jp",
  "amazon.in",
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "costco.com",
  "samsclub.com",
  "ebay.com",
  "etsy.com",
  "aliexpress.com",
  "alibaba.com",
  "temu.com",
  "shein.com",
  "wish.com",
  "mercadolibre.com",
  "rakuten.com",
  "homedepot.com",
  "lowes.com",
  "wayfair.com",
  "ikea.com",
  "overstock.com",
  "acehardware.com",
  "macys.com",
  "nordstrom.com",
  "kohls.com",
  "jcpenney.com",
  "gap.com",
  "oldnavy.com",
  "nike.com",
  "adidas.com",
  "zappos.com",
  "asos.com",
  "zara.com",
  "hm.com",
  "uniqlo.com",
  "lululemon.com",
  "sephora.com",
  "ulta.com",
  "chewy.com",
  "newegg.com",
  "microcenter.com",
];

export function isEcommerceUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ECOMMERCE_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/**
 * Apply fast defaults for plain URL-to-markdown scrapes.
 * Preserves full auto/browser/proxy behavior when the caller opts in explicitly.
 */
export function describeAppliedDefaults(before: ScrapeArgs, after: ScrapeArgs): string[] {
  const lines: string[] = [];

  if (before.strategy === undefined && isEcommerceUrl(before.url)) {
    if (after.strategy === "auto") {
      lines.push("e-commerce host → strategy=auto, proxy=residential, response_detail=standard");
      return lines;
    }
  }

  if (
    shouldAutoDownload(before) &&
    after.strategy === "download" &&
    before.strategy === undefined
  ) {
    lines.push("full-page HTML → strategy=download, render=static, proxy=direct");
    return lines;
  }

  if (
    (before.cookies !== undefined || before.cookie_header !== undefined) &&
    before.strategy === undefined &&
    after.strategy === "cloudflare"
  ) {
    lines.push("session cookies → Playwright + residential proxy + cloudflare strategy");
  }

  if (
    before.strategy === undefined &&
    after.strategy === "article" &&
    after.render === "static" &&
    after.response_detail === "compact"
  ) {
    lines.push("plain URL → fast static article path (strategy=article, render=static, response_detail=compact)");
  }

  if (before.strategy !== after.strategy && after.strategy !== undefined && lines.length === 0) {
    lines.push(`strategy=${after.strategy}`);
  }
  if (before.render !== after.render && after.render !== undefined && lines.length === 0) {
    lines.push(`render=${after.render}`);
  }
  if (before.proxy !== after.proxy && after.proxy !== undefined && lines.length === 0) {
    lines.push(`proxy=${after.proxy}`);
  }
  if (
    before.response_detail !== after.response_detail &&
    after.response_detail !== undefined &&
    lines.length === 0
  ) {
    lines.push(`response_detail=${after.response_detail}`);
  }

  return lines;
}

export function normalizeScrapeArgs(args: ScrapeArgs): ScrapeArgs {
  if (shouldAutoDownload(args)) {
    return {
      ...args,
      strategy: "download",
      render: args.render ?? "static",
      proxy: args.proxy ?? "direct",
      timeout_ms: args.timeout_ms ?? FAST_SCRAPE_TIMEOUT_MS,
    };
  }

  // Known e-commerce hosts must skip the fast direct-static article path (which
  // returns bot-wall/empty content) and route through `auto` so the API resolves
  // them to the retail strategy with a residential proxy. Respect any explicit
  // strategy/render/proxy the caller already provided.
  if (args.strategy === undefined && isEcommerceUrl(args.url)) {
    return {
      ...args,
      formats: args.formats ?? ["markdown"],
      strategy: "auto",
      render: args.render ?? "auto",
      proxy: args.proxy ?? "residential",
      response_detail: args.response_detail ?? "standard",
    };
  }

  const hasAdvancedOpts =
    args.strategy !== undefined ||
    args.render !== undefined ||
    args.proxy !== undefined ||
    args.screenshot !== undefined ||
    args.wait_for !== undefined ||
    args.cookies !== undefined ||
    args.cookie_header !== undefined ||
    args.headers !== undefined ||
    !isMarkdownOnlyFormats(args.formats);

  if (hasAdvancedOpts) {
    return {
      ...args,
      ...((args.render === "dynamic" || args.render === "auto") && args.strategy === undefined
        ? { strategy: "auto" }
        : {}),
      ...(args.cookies !== undefined || args.cookie_header !== undefined
        ? {
            proxy: args.proxy ?? "residential",
            strategy: args.strategy ?? "cloudflare",
            render: args.render ?? "dynamic",
          }
        : {}),
    };
  }

  return {
    ...args,
    formats: args.formats ?? ["markdown"],
    strategy: "article",
    render: "static",
    response_detail: args.response_detail ?? "compact",
    timeout_ms: args.timeout_ms ?? FAST_SCRAPE_TIMEOUT_MS,
  };
}
