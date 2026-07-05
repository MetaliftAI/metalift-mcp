import assert from "node:assert/strict";
import test from "node:test";
import { scrapeRecoveryHints, formatRecoveryBlock } from "./error-recovery.js";

test("scrapeRecoveryHints suggests seed session for 403", () => {
  const hints = scrapeRecoveryHints({ error: "Access denied", statusCode: 403 });
  assert.match(hints.join(" "), /metalift_seed_session/);
});

test("scrapeRecoveryHints suggests quota fallback", () => {
  const hints = scrapeRecoveryHints({ errorCode: "MONTHLY_QUOTA_EXCEEDED" });
  assert.match(hints.join(" "), /metalift_web_search/);
});

test("formatRecoveryBlock renders bullet list", () => {
  const block = formatRecoveryBlock(["Retry with strategy=auto"]);
  assert.match(block, /Recovery:/);
  assert.match(block, /- Retry with strategy=auto/);
});
