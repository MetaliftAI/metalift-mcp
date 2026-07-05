import {
  extractErrorCode,
  formatRecoveryBlock,
  scrapeRecoveryHints,
  searchRecoveryHints,
} from "./error-recovery.js";
import { wrapResponse, type ResponseStatus } from "./response-envelope.js";

export type ScrapeResponseDetail = "compact" | "standard" | "full";

/** Matches API COMPACT_BODY_MAX_CHARS — keep in sync with scrape_response.py */
export const COMPACT_BODY_MAX_CHARS = 16_000;

export function resolveScrapeResponseDetail(
  result: Record<string, unknown>,
  fallback: ScrapeResponseDetail = "compact"
): ScrapeResponseDetail {
  const detail = result.response_detail;
  if (detail === "compact" || detail === "standard" || detail === "full") {
    return detail;
  }
  return fallback;
}

function formatMetadataBlock(metadata: Record<string, unknown>, detail: ScrapeResponseDetail): string[] {
  const lines: string[] = [];
  const title = typeof metadata.title === "string" ? metadata.title : "Untitled";
  lines.push(`# ${title}`);

  const sourceUrl = typeof metadata.source_url === "string" ? metadata.source_url : "";
  if (sourceUrl) lines.push(`URL: ${sourceUrl}`);

  if (typeof metadata.status_code === "number") {
    lines.push(`HTTP: ${metadata.status_code}`);
  }

  if (detail !== "compact") {
    if (typeof metadata.description === "string" && metadata.description) {
      lines.push(`Description: ${metadata.description.slice(0, 400)}`);
    }
    if (typeof metadata.strategy === "string") {
      lines.push(`Strategy: ${metadata.strategy}`);
    }
    if (typeof metadata.links_total === "number") {
      lines.push(`Links: ${metadata.links_total} total`);
    } else if (Array.isArray(metadata.links) && metadata.links.length > 0) {
      lines.push(`Links: ${metadata.links.length} included`);
    }
  }

  return lines;
}

export interface FormatScrapeOptions {
  appliedDefaults?: string[];
}

export function formatScrapeResponse(
  result: Record<string, unknown>,
  detail: ScrapeResponseDetail = resolveScrapeResponseDetail(result),
  options: FormatScrapeOptions = {}
): string {
  if (detail === "full") {
    return JSON.stringify(result, null, 2);
  }

  const success = result.success === true;
  const credits =
    typeof result.credits_charged === "number" ? result.credits_charged : undefined;
  const data = result.data as Record<string, unknown> | undefined;
  const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
  const markdown = typeof data?.markdown === "string" ? data.markdown : "";
  const text = typeof data?.text === "string" ? data.text : "";
  const body = markdown || text;
  const errorMessage = typeof result.error === "string" ? result.error : "Scrape failed";
  const statusCode =
    typeof metadata.status_code === "number" ? metadata.status_code : undefined;

  const bodyLines = [
    ...formatMetadataBlock(metadata, detail),
    `Detail: ${detail}`,
    "",
  ];

  if (!success) {
    bodyLines.push(`Error: ${errorMessage}`);
    bodyLines.push("");
    bodyLines.push(
      formatRecoveryBlock(
        scrapeRecoveryHints({
          error: errorMessage,
          errorCode: extractErrorCode(result),
          statusCode,
          url: typeof metadata.source_url === "string" ? metadata.source_url : undefined,
          emptyBody: !body,
        })
      )
    );
    return wrapResponse({
      status: "failed",
      credits: credits ?? null,
      appliedDefaults: options.appliedDefaults,
      body: bodyLines.join("\n").trim(),
      nextStep: "Follow recovery hints above before retrying.",
    });
  }

  if (body) {
    bodyLines.push(body);
  } else {
    bodyLines.push("(No markdown/text content in response.)");
    bodyLines.push("");
    bodyLines.push(
      formatRecoveryBlock(
        scrapeRecoveryHints({
          error: "empty content",
          url: typeof metadata.source_url === "string" ? metadata.source_url : undefined,
          emptyBody: true,
          statusCode,
        })
      )
    );
  }

  const nextStep =
    detail === "compact"
      ? "Summarize in plain language. Use response_detail=standard for full page text."
      : "Summarize in plain language. Use response_detail=full for complete JSON including all links.";

  return wrapResponse({
    status: body ? "success" : "partial",
    credits: credits ?? null,
    appliedDefaults: options.appliedDefaults,
    body: bodyLines.join("\n").trim(),
    nextStep,
  });
}

export function isScrapeFailure(result: Record<string, unknown>): boolean {
  if (result.success === false) {
    return true;
  }
  const data = result.data as Record<string, unknown> | undefined;
  const markdown = typeof data?.markdown === "string" ? data.markdown : "";
  const text = typeof data?.text === "string" ? data.text : "";
  return result.success === true && !markdown && !text;
}

export function formatBatchScrapeResponse(
  result: Record<string, unknown>,
  detail: ScrapeResponseDetail = resolveScrapeResponseDetail(result),
  options: FormatScrapeOptions = {}
): string {
  if (detail === "full") {
    return JSON.stringify(result, null, 2);
  }

  const pages = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  const credits =
    typeof result.credits_charged === "number" ? result.credits_charged : undefined;
  const failedCount = pages.filter((page) => {
    const md = typeof page.markdown === "string" ? page.markdown : "";
    const tx = typeof page.text === "string" ? page.text : "";
    return !md && !tx;
  }).length;

  const status: ResponseStatus =
    failedCount === 0 ? "success" : failedCount === pages.length ? "failed" : "partial";

  const sections: string[] = [`Batch scrape: ${pages.length} page(s)`, ""];

  for (let i = 0; i < pages.length; i++) {
    sections.push(`--- Page ${i + 1} ---`);
    sections.push(
      formatScrapeResponse(
        { success: true, response_detail: detail, data: pages[i] },
        detail
      )
    );
    sections.push("");
  }

  return wrapResponse({
    status,
    credits: credits ?? null,
    appliedDefaults: options.appliedDefaults,
    body: sections.join("\n").trim(),
    nextStep: "Summarize findings across pages in plain language.",
  });
}

export { searchRecoveryHints, formatRecoveryBlock };
