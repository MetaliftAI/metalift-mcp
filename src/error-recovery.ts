export interface RecoveryContext {
  error?: string;
  errorCode?: string;
  statusCode?: number;
  url?: string;
  emptyBody?: boolean;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase();
}

export function extractErrorCode(result: Record<string, unknown>): string | undefined {
  const code = result.code;
  if (typeof code === "string" && code) {
    return code;
  }

  const detail = result.detail;
  if (typeof detail === "object" && detail !== null) {
    const detailCode = (detail as Record<string, unknown>).code;
    if (typeof detailCode === "string" && detailCode) {
      return detailCode;
    }
  }

  return undefined;
}

export function scrapeRecoveryHints(context: RecoveryContext): string[] {
  const hints: string[] = [];
  const error = normalizeText(context.error);
  const code = normalizeText(context.errorCode);

  if (
    code.includes("enterprise_strategy") ||
    error.includes("enterprise or partner tier")
  ) {
    hints.push(
      "strategy=raw and full-page HTML (without strategy=download) require Enterprise or Partner tier."
    );
    hints.push(
      'For full static HTML on any tier, use strategy=download with formats=["html"] and only_main_content=false.'
    );
    hints.push(
      "For article markdown on any tier, omit strategy (defaults to article) or use response_detail=standard."
    );
    return hints;
  }

  if (
    code.includes("quota") ||
    code.includes("usage") ||
    code.includes("payment") ||
    error.includes("quota") ||
    error.includes("credit")
  ) {
    hints.push("Check remaining credits; prefer metalift_web_search snippets over scraping when possible.");
    return hints;
  }

  if (
    code.includes("robots") ||
    code.includes("opt_out") ||
    code.includes("url_risk") ||
    code.includes("ssrf")
  ) {
    hints.push("This URL is blocked by policy — do not retry; choose a different source.");
    return hints;
  }

  if (
    context.statusCode === 403 ||
    code.includes("blocked") ||
    code.includes("waf") ||
    code.includes("forbidden") ||
    error.includes("blocked") ||
    error.includes("access denied") ||
    error.includes("captcha")
  ) {
    hints.push(
      "Ask the user for browser cookies, then metalift_seed_session with storage_state or cookie_header + matching User-Agent."
    );
    hints.push("Or retry with strategy=cloudflare or strategy=auto; consider metalift_warm_session for retail/WAF sites.");
    return hints;
  }

  if (
    context.emptyBody ||
    error.includes("empty") ||
    error.includes("bot") ||
    error.includes("no content") ||
    error.includes("challenge")
  ) {
    hints.push("Retry with strategy=auto or strategy=cloudflare.");
    hints.push("For retail sites, use strategy=retail or metalift_warm_session before scraping.");
    return hints;
  }

  if (error.includes("timeout") || code.includes("timeout")) {
    hints.push("Increase timeout_ms or use async=true with metalift_job_status for long jobs.");
    return hints;
  }

  hints.push("Retry with strategy=auto; use response_detail=standard if compact truncated useful content.");
  if (context.url) {
    hints.push(`If still failing, ask the user for session cookies for ${new URL(context.url).hostname}.`);
  }

  return hints;
}

export function formatRecoveryBlock(hints: string[]): string {
  if (hints.length === 0) {
    return "";
  }
  return ["Recovery:", ...hints.map((hint) => `- ${hint}`)].join("\n");
}

export function searchRecoveryHints(): string[] {
  return [
    "Search unavailable on this API host — answer from known URLs if the user provided them.",
    "Or scrape a specific URL directly with metalift_scrape when you know the target page.",
  ];
}
