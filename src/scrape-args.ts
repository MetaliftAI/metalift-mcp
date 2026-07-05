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
  response_detail?: ScrapeResponseDetail;
}

/** Default timeout for the fast direct static markdown path. */
export const FAST_SCRAPE_TIMEOUT_MS = 10_000;

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
    !isMarkdownOnlyFormats(args.formats);

  if (hasAdvancedOpts) {
    return { ...args };
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
