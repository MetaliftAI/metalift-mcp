import { wrapResponse } from "./response-envelope.js";

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

  const bodyLines = [`Query: ${query}`, `Results: ${results.length}`, ""];

  if (results.length === 0) {
    bodyLines.push("No relevant results. Try rephrasing the query.");
  } else {
    for (let i = 0; i < results.length; i++) {
      const row = results[i] as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title : "Untitled";
      const url = typeof row.url === "string" ? row.url : "";
      const snippet = typeof row.snippet === "string" ? row.snippet : "";
      bodyLines.push(`${i + 1}. ${title}`);
      bodyLines.push(`   URL: ${url}`);
      if (snippet) {
        bodyLines.push(`   ${snippet.slice(0, 320)}${snippet.length > 320 ? "…" : ""}`);
      }
      bodyLines.push("");
    }
  }

  return wrapResponse({
    status: results.length > 0 ? "success" : "partial",
    credits,
    body: bodyLines.join("\n").trim(),
    nextStep:
      "Answer simple questions from snippets when possible. Only call metalift_scrape when full page content is required.",
  });
}
