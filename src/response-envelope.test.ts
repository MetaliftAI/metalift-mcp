import assert from "node:assert/strict";
import test from "node:test";
import { mcpTextResult, wrapResponse } from "./response-envelope.js";

test("wrapResponse builds header body footer", () => {
  const out = wrapResponse({
    status: "success",
    credits: 2,
    appliedDefaults: ["strategy=auto"],
    body: "Hello",
    nextStep: "Summarize for the user.",
  });
  assert.match(out, /Status: success/);
  assert.match(out, /Credits: 2/);
  assert.match(out, /Applied routing: strategy=auto/);
  assert.match(out, /Hello/);
  assert.match(out, /Next: Summarize for the user\./);
});

test("mcpTextResult sets isError when requested", () => {
  const result = mcpTextResult("failed", true);
  assert.equal(result.isError, true);
});
