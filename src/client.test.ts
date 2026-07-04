import assert from "node:assert/strict";
import test from "node:test";
import { billingFromResponse, withBilling } from "./client.js";

test("billingFromResponse parses credit headers", () => {
  const response = new Response("{}", {
    headers: {
      "X-Metalift-Credits-Charged": "5",
      "X-Metalift-Credits-Estimated": "10",
    },
  });
  assert.deepEqual(billingFromResponse(response), {
    credits_charged: 5,
    credits_estimated: 10,
  });
});

test("billingFromResponse returns null when headers are missing", () => {
  const response = new Response("{}");
  assert.deepEqual(billingFromResponse(response), {
    credits_charged: null,
    credits_estimated: null,
  });
});

test("withBilling merges billing fields into API payload", () => {
  const merged = withBilling({ success: true }, { credits_charged: 1, credits_estimated: null });
  assert.equal(merged.success, true);
  assert.equal(merged.credits_charged, 1);
  assert.equal(merged.credits_estimated, null);
});
