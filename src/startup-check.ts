import { MetaliftClient } from "./client.js";

export interface StartupCheckResult {
  ok: boolean;
  apiUrl: string;
  apiKeyConfigured: boolean;
  healthStatus?: string;
  error?: string;
}

/** Validate env and API reachability; messages go to stderr for Claude/Cursor MCP logs. */
export async function runStartupCheck(): Promise<StartupCheckResult> {
  const apiUrl = (process.env.METALIFT_API_URL || "https://api.metalift.ai").replace(/\/$/, "");
  const apiKey = process.env.METALIFT_API_KEY?.trim();
  const apiKeyConfigured = Boolean(apiKey && apiKey !== "YOUR_API_KEY");

  if (!apiKeyConfigured) {
    console.error(
      "[metalift-mcp] METALIFT_API_KEY is missing or still set to YOUR_API_KEY. " +
        "Add your key to the MCP env block in claude_desktop_config.json, then fully quit and restart Claude Desktop.",
    );
    return { ok: false, apiUrl, apiKeyConfigured: false };
  }

  const client = new MetaliftClient({ apiUrl, apiKey });
  try {
    const health = await client.health();
    console.error(
      `[metalift-mcp] Connected to ${apiUrl} (status=${health.status}, version=${health.version}).`,
    );
    return { ok: true, apiUrl, apiKeyConfigured: true, healthStatus: health.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[metalift-mcp] API health check failed: ${message}`);
    return { ok: false, apiUrl, apiKeyConfigured: true, error: message };
  }
}
