export const SEARCH_UNAVAILABLE_DOCS = "https://metalift.ai/docs/release-notes";

export function searchUnavailableMessage(apiUrl: string, statusCode?: number): string {
  const status = statusCode ? ` (HTTP ${statusCode})` : "";
  return (
    `Web search is not available on ${apiUrl}${status}. ` +
    "POST /v1/search was not found or search is temporarily unavailable. " +
    "See " +
    `${SEARCH_UNAVAILABLE_DOCS} for availability and rollout status. ` +
    "Fallback: scrape a known URL directly with metalift_scrape when the user provides a target page."
  );
}

export function formatSearchApiError(apiUrl: string, body: unknown, status: number): string | null {
  if (status === 404) {
    return searchUnavailableMessage(apiUrl, status);
  }
  if (status === 503) {
    const detail =
      typeof body === "object" && body !== null && "detail" in body
        ? String((body as { detail?: unknown }).detail ?? "")
        : "";
    if (/search|searxng/i.test(detail)) {
      return searchUnavailableMessage(apiUrl, status);
    }
  }
  return null;
}
