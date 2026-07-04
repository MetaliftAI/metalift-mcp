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
