import type { MetaliftClient } from "./client.js";
import { wrapResponse } from "./response-envelope.js";

/** Minimal MCP tool-handler context needed for progress notifications. */
export interface ToolHandlerExtra {
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: {
    method: string;
    params: Record<string, unknown>;
  }) => Promise<void>;
}

export interface ProgressReporter {
  report: (message: string, progress: number, total?: number) => Promise<void>;
}

export function createProgressReporter(extra?: ToolHandlerExtra): ProgressReporter {
  return {
    async report(message: string, progress: number, total?: number) {
      console.error(`[metalift-mcp] ${message}`);

      const progressToken = extra?._meta?.progressToken;
      if (progressToken === undefined || !extra?.sendNotification) {
        return;
      }

      const params: Record<string, unknown> = { progressToken, progress, message };
      if (total !== undefined) {
        params.total = total;
      }

      await extra.sendNotification({
        method: "notifications/progress",
        params,
      });
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send periodic progress while a blocking API call runs. */
export async function runWithProgress<T>(
  extra: ToolHandlerExtra | undefined,
  label: string,
  fn: () => Promise<T>,
  options?: { intervalMs?: number }
): Promise<T> {
  const reporter = createProgressReporter(extra);
  const intervalMs = options?.intervalMs ?? 2_000;
  let tick = 0;
  const started = Date.now();

  await reporter.report(`${label}…`, tick);

  const timer = setInterval(() => {
    tick += 1;
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    void reporter.report(`${label} (${elapsedSec}s elapsed)`, tick);
  }, intervalMs);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

export interface WaitForJobOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export async function waitForJob(
  client: MetaliftClient,
  jobId: string,
  extra: ToolHandlerExtra | undefined,
  options: WaitForJobOptions = {}
): Promise<Record<string, unknown>> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const reporter = createProgressReporter(extra);
  const start = Date.now();
  let tick = 0;
  const shortId = jobId.length > 8 ? `${jobId.slice(0, 8)}…` : jobId;

  while (Date.now() - start < timeoutMs) {
    const job = await client.jobStatus(jobId);
    tick += 1;

    const status = typeof job.status === "string" ? job.status : "unknown";
    const completed = typeof job.completed === "number" ? job.completed : 0;
    const total = typeof job.total === "number" ? job.total : undefined;
    const credits = job.credits_charged;

    let message = `Job ${shortId}: ${status}`;
    if (total !== undefined && total > 0) {
      message += ` — ${completed}/${total} pages`;
    }
    if (typeof credits === "number") {
      message += ` (${credits} credits)`;
    }

    await reporter.report(message, total && total > 0 ? completed : tick, total);

    if (status === "completed" || status === "failed") {
      return job;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Job ${jobId} timed out after ${Math.round(timeoutMs / 1000)}s`);
}

export function formatJobCreated(result: Record<string, unknown>): string {
  const id = typeof result.id === "string" ? result.id : "unknown";
  const status = typeof result.status === "string" ? result.status : "pending";
  const type = typeof result.type === "string" ? result.type : "job";
  const estimate =
    typeof result.credits_estimated === "number" ? result.credits_estimated : undefined;

  const body = [
    `${type} job created`,
    `Job ID: ${id}`,
    `Status: ${status}`,
    estimate !== undefined ? `Credits estimated: ${estimate}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return wrapResponse({
    status: "partial",
    credits: estimate ?? null,
    body,
    nextStep: "Poll with metalift_job_status, or call with wait=true to block until done.",
  });
}

export function formatJobStatus(job: Record<string, unknown>): string {
  const status = typeof job.status === "string" ? job.status : "unknown";
  const bodyLines = [`Job: ${job.id ?? "unknown"}`, `Status: ${status}`];

  if (typeof job.type === "string") {
    bodyLines.push(`Type: ${job.type}`);
  }

  const completed = job.completed;
  const total = job.total;
  if (typeof completed === "number" && typeof total === "number" && total > 0) {
    const pct = Math.round((completed / total) * 100);
    bodyLines.push(`Progress: ${completed}/${total} (${pct}%)`);
  } else if (typeof completed === "number" && completed > 0) {
    bodyLines.push(`Completed: ${completed}`);
  }

  if (typeof job.credits_charged === "number") {
    bodyLines.push(`Credits charged: ${job.credits_charged}`);
  }
  if (typeof job.credits_estimated === "number") {
    bodyLines.push(`Credits estimated: ${job.credits_estimated}`);
  }

  if (status === "failed" && job.error) {
    bodyLines.push(`Error: ${String(job.error)}`);
  }

  const data = job.data;
  if (Array.isArray(data) && data.length > 0) {
    bodyLines.push(`Pages collected: ${data.length}`, "");
    for (let i = 0; i < Math.min(data.length, 5); i++) {
      const page = data[i];
      if (typeof page !== "object" || page === null) continue;
      const record = page as Record<string, unknown>;
      const metadata =
        typeof record.metadata === "object" && record.metadata !== null
          ? (record.metadata as Record<string, unknown>)
          : undefined;
      const title =
        (typeof metadata?.title === "string" && metadata.title) ||
        (typeof record.url === "string" && record.url) ||
        `Page ${i + 1}`;
      bodyLines.push(`  • ${title}`);
    }
    if (data.length > 5) {
      bodyLines.push(`  … and ${data.length - 5} more`);
    }
  }

  const responseStatus =
    status === "failed" ? "failed" : status === "completed" ? "success" : "partial";

  const nextStep =
    status === "pending" || status === "running"
      ? "Still in progress — call again to refresh."
      : status === "completed"
        ? "Summarize collected pages in plain language."
        : "Review error and retry with different scrape options.";

  return wrapResponse({
    status: responseStatus,
    credits: typeof job.credits_charged === "number" ? job.credits_charged : null,
    body: bodyLines.join("\n"),
    nextStep,
  });
}
