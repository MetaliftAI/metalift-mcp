import assert from "node:assert/strict";
import test from "node:test";
import { formatJobCreated, formatJobStatus } from "./progress.js";

test("formatJobStatus shows progress and page summary", () => {
  const text = formatJobStatus({
    id: "abc-123",
    status: "running",
    type: "crawl",
    completed: 3,
    total: 10,
    credits_charged: 6,
    data: [{ metadata: { title: "Home" } }, { url: "https://example.com/about" }],
  });

  assert.match(text, /Progress: 3\/10 \(30%\)/);
  assert.match(text, /Credits charged: 6/);
  assert.match(text, /Pages collected: 2/);
  assert.match(text, /Still in progress/);
});

test("formatJobCreated includes job id and polling hint", () => {
  const text = formatJobCreated({
    id: "job-xyz",
    status: "pending",
    type: "crawl",
    credits_estimated: 50,
  });

  assert.match(text, /Job ID: job-xyz/);
  assert.match(text, /Credits estimated: 50/);
  assert.match(text, /metalift_job_status/);
});

test("formatJobStatus reports failure", () => {
  const text = formatJobStatus({
    id: "fail-1",
    status: "failed",
    error: "robots.txt disallowed",
  });

  assert.match(text, /Status: failed/);
  assert.match(text, /robots.txt disallowed/);
});
