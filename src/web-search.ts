export const WEB_SEARCH_RESULT_LIMIT = 10;
export const WEB_SEARCH_CREDITS = 2;

export function buildWebSearchRequest(args: {
  query: string;
  categories?: string[];
  language?: string;
}) {
  return {
    ...args,
    language: args.language ?? "en",
    limit: WEB_SEARCH_RESULT_LIMIT,
  };
}

export function formatWebSearchResponse(result: Record<string, unknown>): string {
  const results = Array.isArray(result.results) ? result.results : [];
  const query = typeof result.query === "string" ? result.query : "";
  const credits =
    typeof result.credits_charged === "number" ? result.credits_charged : WEB_SEARCH_CREDITS;

  const lines = [`Query: ${query}`, `Results: ${results.length} (${credits} credits)`, ""];

  if (results.length === 0) {
    lines.push("No relevant results. Try rephrasing the query.");
    return lines.join("\n");
  }

  for (let i = 0; i < results.length; i++) {
    const row = results[i] as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title : "Untitled";
    const url = typeof row.url === "string" ? row.url : "";
    const snippet = typeof row.snippet === "string" ? row.snippet : "";
    lines.push(`${i + 1}. ${title}`);
    lines.push(`   URL: ${url}`);
    if (snippet) {
      lines.push(`   ${snippet.slice(0, 320)}${snippet.length > 320 ? "…" : ""}`);
    }
    lines.push("");
  }

  lines.push(
    "Answer simple questions from these snippets when possible. Only call metalift_scrape when full page content is required."
  );
  return lines.join("\n");
}
