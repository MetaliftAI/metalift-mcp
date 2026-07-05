import assert from "node:assert/strict";
import test from "node:test";
import { runStartupCheck } from "./startup-check.js";

test("runStartupCheck warns when API key is missing", async () => {
  const prevUrl = process.env.METALIFT_API_URL;
  const prevKey = process.env.METALIFT_API_KEY;
  delete process.env.METALIFT_API_URL;
  delete process.env.METALIFT_API_KEY;

  const result = await runStartupCheck();
  assert.equal(result.ok, false);
  assert.equal(result.apiKeyConfigured, false);

  if (prevUrl !== undefined) process.env.METALIFT_API_URL = prevUrl;
  if (prevKey !== undefined) process.env.METALIFT_API_KEY = prevKey;
});
