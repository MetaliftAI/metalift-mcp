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

export function formatScrapeResponse(
  result: Record<string, unknown>,
  detail: ScrapeResponseDetail = resolveScrapeResponseDetail(result)
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

  const lines = [
    ...formatMetadataBlock(metadata, detail),
    credits !== undefined ? `Credits: ${credits}` : "",
    `Detail: ${detail}`,
    "",
  ].filter(Boolean);

  if (!success) {
    const err = typeof result.error === "string" ? result.error : "Scrape failed";
    lines.push(`Error: ${err}`);
    return lines.join("\n");
  }

  if (body) {
    lines.push(body);
  } else {
    lines.push("(No markdown/text content in response.)");
  }

  if (detail === "compact") {
    lines.push("");
    lines.push(
      "Summarize in plain language. Use response_detail=standard for full page text or full for raw JSON + all links."
    );
  } else {
    lines.push("");
    lines.push("Summarize in plain language. Use response_detail=full for complete JSON including all links.");
  }

  return lines.join("\n");
}

export function formatBatchScrapeResponse(
  result: Record<string, unknown>,
  detail: ScrapeResponseDetail = resolveScrapeResponseDetail(result)
): string {
  if (detail === "full") {
    return JSON.stringify(result, null, 2);
  }

  const pages = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  const credits =
    typeof result.credits_charged === "number" ? result.credits_charged : undefined;

  const lines = [
    `Batch scrape: ${pages.length} page(s)`,
    credits !== undefined ? `Credits: ${credits}` : "",
    `Detail: ${detail}`,
    "",
  ].filter(Boolean);

  for (let i = 0; i < pages.length; i++) {
    lines.push(`--- Page ${i + 1} ---`);
    lines.push(
      formatScrapeResponse(
        { success: true, response_detail: detail, data: pages[i] },
        detail
      )
    );
    lines.push("");
  }

  return lines.join("\n").trim();
}
