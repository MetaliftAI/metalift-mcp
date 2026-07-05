import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMapResponse,
  formatSitemapResponse,
  formatStrategiesResponse,
} from "./tool-formatters.js";

test("formatSitemapResponse renders numbered URLs", () => {
  const out = formatSitemapResponse({
    credits_charged: 1,
    urls: [{ url: "https://example.com/a", lastmod: "2024-01-01" }],
    source: "https://example.com/sitemap.xml",
  });
  assert.match(out, /Status: success/);
  assert.match(out, /Credits: 1/);
  assert.match(out, /1\. https:\/\/example\.com\/a/);
});

test("formatMapResponse notes HTML discovery", () => {
  const out = formatMapResponse({
    credits_charged: 1,
    urls: ["https://example.com/page"],
  });
  assert.match(out, /HTML anchor parsing/);
  assert.match(out, /https:\/\/example\.com\/page/);
});

test("formatStrategiesResponse renders strategy rows", () => {
  const out = formatStrategiesResponse({
    strategies: [
      { name: "article", protection_level: "low", credits_estimate: 1, description: "Fast static" },
    ],
  });
  assert.match(out, /article/);
  assert.match(out, /1 credits/);
});
