import { wrapResponse } from "./response-envelope.js";

function creditsFromResult(result: Record<string, unknown>): number | null {
  return typeof result.credits_charged === "number" ? result.credits_charged : null;
}

function formatUrlRows(
  urls: unknown[],
  options?: { showLastmod?: boolean; maxRows?: number }
): string[] {
  const maxRows = options?.maxRows ?? 50;
  const lines: string[] = [];

  for (let i = 0; i < Math.min(urls.length, maxRows); i++) {
    const row = urls[i];
    if (typeof row === "string") {
      lines.push(`${i + 1}. ${row}`);
      continue;
    }
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    const lastmod = typeof record.lastmod === "string" ? record.lastmod : "";
    if (url) {
      lines.push(`${i + 1}. ${url}${lastmod && options?.showLastmod ? ` (${lastmod})` : ""}`);
    }
  }

  if (urls.length > maxRows) {
    lines.push(`… and ${urls.length - maxRows} more URLs`);
  }

  return lines;
}

export function formatSitemapResponse(result: Record<string, unknown>): string {
  const urls = Array.isArray(result.urls) ? result.urls : [];
  const source = typeof result.source === "string" ? result.source : undefined;
  const credits = creditsFromResult(result);

  const body = [
    `Sitemap URLs: ${urls.length}`,
    source ? `Source: ${source}` : "",
    "",
    ...(urls.length === 0
      ? ["No URLs found. Try metalift_map if the site has no XML sitemap."]
      : formatUrlRows(urls, { showLastmod: true })),
  ]
    .filter(Boolean)
    .join("\n");

  return wrapResponse({
    status: urls.length > 0 ? "success" : "partial",
    credits,
    body,
    nextStep:
      urls.length > 0
        ? "Filter URLs, then metalift_scrape selected pages (response_detail=compact)."
        : "Try metalift_map for HTML link discovery.",
  });
}

export function formatMapResponse(result: Record<string, unknown>): string {
  const urls = Array.isArray(result.urls) ? result.urls : [];
  const credits = creditsFromResult(result);

  const body = [
    `Discovered URLs: ${urls.length} (HTML anchor parsing — not XML sitemap)`,
    "",
    ...(urls.length === 0
      ? ["No links found on this page."]
      : formatUrlRows(urls)),
  ].join("\n");

  return wrapResponse({
    status: urls.length > 0 ? "success" : "partial",
    credits,
    body,
    nextStep:
      urls.length > 0
        ? "Scrape selected URLs with metalift_scrape; prefer metalift_sitemap when available."
        : "Try metalift_sitemap or a different seed URL.",
  });
}

export function formatStrategiesResponse(result: Record<string, unknown>): string {
  const strategies = Array.isArray(result.strategies) ? result.strategies : [];
  const lines = ["Available scrape strategies:", ""];

  for (const item of strategies) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "unknown";
    const protection =
      typeof row.protection_level === "string" ? row.protection_level : undefined;
    const credits =
      typeof row.credits_estimate === "number"
        ? row.credits_estimate
        : typeof row.credits === "number"
          ? row.credits
          : undefined;
    const description = typeof row.description === "string" ? row.description : "";

    lines.push(`• ${name}${protection ? ` (${protection})` : ""}${credits !== undefined ? ` — ~${credits} credits` : ""}`);
    if (description) {
      lines.push(`  ${description.slice(0, 200)}`);
    }
  }

  if (strategies.length === 0) {
    lines.push("(No strategies returned.)");
  }

  return wrapResponse({
    status: strategies.length > 0 ? "success" : "partial",
    body: lines.join("\n"),
    nextStep: "Use strategy=auto for unknown pages; strategy=article for fast static docs.",
  });
}

export function formatSessionsListResponse(result: Record<string, unknown>): string {
  const sessions = Array.isArray(result.sessions) ? result.sessions : [];
  const lines = [`Stored sessions: ${sessions.length}`, ""];

  for (const item of sessions) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const domain = typeof row.domain === "string" ? row.domain : "unknown";
    const expires = typeof row.expires_at === "string" ? row.expires_at : undefined;
    const source = typeof row.source === "string" ? row.source : undefined;
    lines.push(`• ${domain}${source ? ` (${source})` : ""}${expires ? ` — expires ${expires}` : ""}`);
  }

  if (sessions.length === 0) {
    lines.push("No sessions stored. Use metalift_seed_session after the user provides browser cookies.");
  }

  return wrapResponse({
    status: "success",
    body: lines.join("\n"),
    nextStep: "Scrape protected URLs without passing cookies — seeded session auto-applies.",
  });
}

export function formatSeedSessionResponse(result: Record<string, unknown>): string {
  const domain = typeof result.domain === "string" ? result.domain : "unknown";
  const cookieCount =
    typeof result.cookie_count === "number" ? result.cookie_count : undefined;
  const success = result.success !== false;

  const body = [
    success ? `Session stored for ${domain}.` : `Failed to store session for ${domain}.`,
    cookieCount !== undefined ? `Cookies: ${cookieCount}` : "",
    typeof result.error === "string" ? `Error: ${result.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return wrapResponse({
    status: success ? "success" : "failed",
    body,
    nextStep: success
      ? `Call metalift_scrape on ${domain} URLs without cookie args.`
      : "Ask the user for Playwright storage_state or a valid Cookie header + User-Agent.",
  });
}

export function formatWarmSessionResponse(result: Record<string, unknown>): string {
  const domain = typeof result.domain === "string" ? result.domain : undefined;
  const success = result.success !== false;
  const credits = creditsFromResult(result);

  const body = [
    success ? "Session warmed via browser." : "Session warmup failed.",
    domain ? `Domain: ${domain}` : "",
    typeof result.error === "string" ? `Error: ${result.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return wrapResponse({
    status: success ? "success" : "failed",
    credits,
    body,
    nextStep: success
      ? "Retry metalift_scrape on protected URLs for this domain."
      : "Ask the user for manual cookies via metalift_seed_session; warmup often fails on strict WAFs.",
  });
}
