import type { ScrapeArgs } from "./scrape-args.js";
import { formatSearchApiError } from "./search-errors.js";

export interface MetaliftClientOptions {
  apiUrl?: string;
  apiKey?: string;
}

export interface BillingMeta {
  credits_charged: number | null;
  credits_estimated: number | null;
}

const B2B_ATTESTATION_HEADER = "X-B2B-Attestation";
const B2B_ATTESTATION_VALUE = "I-confirm-B2B-use";
const CLIENT_ID_HEADER = "X-Metalift-Client";
const MCP_CLIENT_VERSION = "1.0.3";
const CREDITS_CHARGED_HEADER = "X-Metalift-Credits-Charged";
const CREDITS_ESTIMATED_HEADER = "X-Metalift-Credits-Estimated";

function parseHeaderInt(value: string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function billingFromResponse(response: Response): BillingMeta {
  return {
    credits_charged: parseHeaderInt(response.headers.get(CREDITS_CHARGED_HEADER)),
    credits_estimated: parseHeaderInt(response.headers.get(CREDITS_ESTIMATED_HEADER)),
  };
}

export function withBilling<T extends Record<string, unknown>>(body: T, billing: BillingMeta): T & BillingMeta {
  return { ...body, ...billing };
}

function formatApiError(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === "string" && detail) {
      return detail;
    }
    if (typeof detail === "object" && detail !== null) {
      const detailRecord = detail as Record<string, unknown>;
      const message = detailRecord.message;
      const code = detailRecord.code;
      if (typeof message === "string" && message) {
        return typeof code === "string" ? `${message} (${code})` : message;
      }
    }
    const error = record.error;
    if (typeof error === "string" && error) {
      return error;
    }
  }
    if (typeof body === "string" && body.trim()) {
        const trimmed = body.trim();
        if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
            return `Request failed: ${status} (received HTML instead of JSON — check METALIFT_API_URL points to the scrape API, e.g. http://localhost:8080)`;
        }
    return trimmed.slice(0, 500);
  }
  return `Request failed: ${status}`;
}

export function formatFetchError(error: unknown, apiUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : error instanceof Error && typeof error.cause === "string"
        ? error.cause
        : null;

  const hints: string[] = [
    `Could not reach Metalift API at ${apiUrl}.`,
    "Check METALIFT_API_URL and METALIFT_API_KEY in your MCP config env block.",
    "Verify outbound HTTPS to the API from PowerShell: curl https://api.metalift.ai/health",
  ];

  if (/certificate|UNABLE_TO_VERIFY|self signed|cert/i.test(`${message} ${cause ?? ""}`)) {
    hints.push(
      "TLS certificate verification failed — common on corporate Windows. Set NODE_EXTRA_CA_CERTS to your org root CA in the MCP env block.",
    );
  }

  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket/i.test(`${message} ${cause ?? ""}`)) {
    hints.push("Network or DNS blocked the request — check firewall, VPN, or proxy settings.");
  }

  const detail = cause && cause !== message ? `${message} (${cause})` : message;
  return `${detail}\n\n${hints.join(" ")}`;
}

export class MetaliftClient {
  private apiUrl: string;
  private apiKey?: string;

  constructor(options: MetaliftClientOptions = {}) {
    this.apiUrl = (options.apiUrl || process.env.METALIFT_API_URL || "https://api.metalift.ai").replace(/\/$/, "");
    this.apiKey = options.apiKey || process.env.METALIFT_API_KEY;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [B2B_ATTESTATION_HEADER]: B2B_ATTESTATION_VALUE,
      [CLIENT_ID_HEADER]: `mcp/${MCP_CLIENT_VERSION}`,
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async request<T extends Record<string, unknown>>(
    path: string,
    init?: RequestInit,
    options?: { timeoutMs?: number }
  ): Promise<T & BillingMeta> {
    let response: Response;
    const timeoutMs = options?.timeoutMs;
    const signal =
      timeoutMs !== undefined
        ? AbortSignal.timeout(timeoutMs)
        : init?.signal ?? undefined;

    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        signal,
        headers: { ...this.headers(), ...(init?.headers as Record<string, string> | undefined) },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `Request to ${path} timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s. Try async mode or increase timeout_ms.`,
        );
      }
      throw new Error(formatFetchError(error, this.apiUrl));
    }
    const rawBody = await response.text();
    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new Error(formatApiError(rawBody, response.status));
    }
    if (!response.ok) {
      const searchError = path === "/v1/search" ? formatSearchApiError(this.apiUrl, body, response.status) : null;
      throw new Error(searchError || formatApiError(body, response.status));
    }
    return withBilling(body as T, billingFromResponse(response));
  }

  scrape(params: ScrapeArgs | Record<string, unknown>, options?: { timeoutMs?: number }) {
    return this.request(
      "/v1/scrape",
      { method: "POST", body: JSON.stringify(params) },
      options
    );
  }

  batch(params: Record<string, unknown>, options?: { timeoutMs?: number }) {
    return this.request(
      "/v1/batch",
      { method: "POST", body: JSON.stringify(params) },
      options
    );
  }

  crawl(params: Record<string, unknown>) {
    return this.request("/v1/crawl", { method: "POST", body: JSON.stringify(params) });
  }

  map(params: Record<string, unknown>, options?: { timeoutMs?: number }) {
    return this.request(
      "/v1/map",
      { method: "POST", body: JSON.stringify(params) },
      options
    );
  }

  search(params: Record<string, unknown>) {
    return this.request("/v1/search", { method: "POST", body: JSON.stringify(params) });
  }

  jobStatus(jobId: string) {
    return this.request(`/v1/jobs/${jobId}`);
  }

  listStrategies() {
    return this.request<{ success: boolean; strategies: unknown[] }>("/v1/strategies");
  }

  listProtectionTypes() {
    return this.request<{ success: boolean; protection_types: unknown[] }>("/v1/protection-types");
  }

  listSessions() {
    return this.request<{ success: boolean; sessions: unknown[] }>("/v1/sessions");
  }

  warmSession(params: Record<string, unknown>, options?: { timeoutMs?: number }) {
    return this.request(
      "/v1/sessions/fetch",
      { method: "POST", body: JSON.stringify(params) },
      options
    );
  }

  seedSession(params: Record<string, unknown>) {
    return this.request<{ success: boolean; domain: string; cookie_count: number }>(
      "/v1/sessions",
      { method: "PUT", body: JSON.stringify(params) }
    );
  }

  health() {
    return this.request<{ status: string; version: string; browser_ready?: boolean }>("/health");
  }
}
