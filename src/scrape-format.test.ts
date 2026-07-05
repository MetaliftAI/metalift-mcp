import assert from "node:assert/strict";
import test from "node:test";
import {
  formatScrapeResponse,
  isScrapeFailure,
  resolveScrapeResponseDetail,
} from "./scrape-format.js";

test("resolveScrapeResponseDetail reads API field", () => {
  assert.equal(resolveScrapeResponseDetail({ response_detail: "full" }), "full");
  assert.equal(resolveScrapeResponseDetail({}), "compact");
});

test("formatScrapeResponse compact omits links from output", () => {
  const out = formatScrapeResponse({
    success: true,
    response_detail: "compact",
    credits_charged: 1,
    data: {
      metadata: {
        title: "Docker Docs",
        source_url: "https://docs.docker.com/",
        status_code: 200,
        links: ["https://example.com/a"],
      },
      markdown: "# Hello",
    },
  });
  assert.match(out, /Status: success/);
  assert.match(out, /Credits: 1/);
  assert.match(out, /Detail: compact/);
  assert.match(out, /# Hello/);
  assert.doesNotMatch(out, /example\.com\/a/);
});

test("formatScrapeResponse full returns JSON", () => {
  const payload = {
    success: true,
    response_detail: "full",
    data: { markdown: "# Hi", metadata: { links: ["https://x.com"] } },
  };
  const out = formatScrapeResponse(payload, "full");
  assert.match(out, /"links"/);
  assert.match(out, /https:\/\/x\.com/);
});

test("formatScrapeResponse standard includes extra metadata lines", () => {
  const out = formatScrapeResponse({
    success: true,
    response_detail: "standard",
    data: {
      metadata: {
        title: "Page",
        source_url: "https://example.com",
        description: "A description",
        strategy: "article",
        links_total: 100,
      },
      markdown: "body",
    },
  });
  assert.match(out, /Description:/);
  assert.match(out, /Strategy: article/);
  assert.match(out, /Links: 100 total/);
});

test("formatScrapeResponse includes applied defaults", () => {
  const out = formatScrapeResponse(
    {
      success: true,
      credits_charged: 5,
      data: { markdown: "body", metadata: { title: "Page", source_url: "https://example.com" } },
    },
    "compact",
    { appliedDefaults: ["e-commerce host → strategy=auto, proxy=residential, response_detail=standard"] }
  );
  assert.match(out, /Applied routing: e-commerce host/);
});

test("formatScrapeResponse failure includes recovery hints", () => {
  const out = formatScrapeResponse({
    success: false,
    error: "Access denied",
    data: { metadata: { source_url: "https://example.com", status_code: 403 } },
  });
  assert.match(out, /Status: failed/);
  assert.match(out, /Recovery:/);
  assert.match(out, /metalift_seed_session/);
});

test("isScrapeFailure detects soft failures", () => {
  assert.equal(isScrapeFailure({ success: false }), true);
  assert.equal(
    isScrapeFailure({ success: true, data: { markdown: "", metadata: {} } }),
    true
  );
  assert.equal(
    isScrapeFailure({ success: true, data: { markdown: "ok", metadata: {} } }),
    false
  );
});
