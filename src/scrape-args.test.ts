import assert from "node:assert/strict";
import test from "node:test";
import {
  FAST_SCRAPE_TIMEOUT_MS,
  isEcommerceUrl,
  normalizeScrapeArgs,
} from "./scrape-args.js";

const BASE_URL = "https://example.com/docs";
const AMAZON_URL = "https://www.amazon.com";

test("normalizeScrapeArgs applies fast defaults for plain markdown scrape", () => {
  assert.deepEqual(normalizeScrapeArgs({ url: BASE_URL }), {
    url: BASE_URL,
    formats: ["markdown"],
    strategy: "article",
    render: "static",
    response_detail: "compact",
    timeout_ms: FAST_SCRAPE_TIMEOUT_MS,
  });
});

test("normalizeScrapeArgs preserves explicit timeout_ms", () => {
  assert.equal(
    normalizeScrapeArgs({ url: BASE_URL, timeout_ms: 30_000 }).timeout_ms,
    30_000
  );
});

test("normalizeScrapeArgs preserves explicit strategy auto", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, strategy: "auto" });
  assert.equal(args.strategy, "auto");
  assert.equal(args.render, undefined);
  assert.equal(args.proxy, undefined);
});

test("normalizeScrapeArgs preserves explicit specialized strategy", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, strategy: "cloudflare" });
  assert.equal(args.strategy, "cloudflare");
  assert.equal(args.render, undefined);
});

test("normalizeScrapeArgs preserves explicit render auto", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, render: "auto" });
  assert.equal(args.render, "auto");
  assert.equal(args.strategy, undefined);
});

test("normalizeScrapeArgs preserves explicit render dynamic", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, render: "dynamic" });
  assert.equal(args.render, "dynamic");
});

test("normalizeScrapeArgs preserves explicit proxy auto", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, proxy: "auto" });
  assert.equal(args.proxy, "auto");
});

test("normalizeScrapeArgs preserves explicit premium proxy", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, proxy: "residential" });
  assert.equal(args.proxy, "residential");
});

test("normalizeScrapeArgs preserves screenshot requests", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, screenshot: true });
  assert.equal(args.screenshot, true);
  assert.equal(args.strategy, undefined);
});

test("normalizeScrapeArgs preserves wait_for selector", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, wait_for: "main" });
  assert.equal(args.wait_for, "main");
});

test("normalizeScrapeArgs preserves cookies", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, cookies: { sid: "abc" } });
  assert.deepEqual(args.cookies, { sid: "abc" });
});

test("normalizeScrapeArgs preserves cookie_header", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, cookie_header: "sid=abc" });
  assert.equal(args.cookie_header, "sid=abc");
});

test("normalizeScrapeArgs routes cookies through browser session defaults", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, cookie_header: "sid=abc" });
  assert.equal(args.strategy, "cloudflare");
  assert.equal(args.proxy, "residential");
  assert.equal(args.render, "dynamic");
});

test("normalizeScrapeArgs auto-selects download for full-page HTML", () => {
  const args = normalizeScrapeArgs({
    url: BASE_URL,
    formats: ["html"],
    only_main_content: false,
  });
  assert.equal(args.strategy, "download");
  assert.equal(args.render, "static");
  assert.equal(args.proxy, "direct");
  assert.equal(args.timeout_ms, FAST_SCRAPE_TIMEOUT_MS);
});

test("normalizeScrapeArgs preserves explicit cloudflare for full-page HTML", () => {
  const args = normalizeScrapeArgs({
    url: BASE_URL,
    formats: ["html"],
    only_main_content: false,
    strategy: "cloudflare",
    render: "dynamic",
  });
  assert.equal(args.strategy, "cloudflare");
  assert.equal(args.render, "dynamic");
});

test("normalizeScrapeArgs preserves non-markdown formats", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, formats: ["html"] });
  assert.deepEqual(args.formats, ["html"]);
  assert.equal(args.strategy, undefined);
});

test("normalizeScrapeArgs preserves multi-format requests", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, formats: ["markdown", "html"] });
  assert.deepEqual(args.formats, ["markdown", "html"]);
});

test("normalizeScrapeArgs treats explicit markdown-only formats as fast path", () => {
  const args = normalizeScrapeArgs({ url: BASE_URL, formats: ["markdown"] });
  assert.equal(args.strategy, "article");
  assert.equal(args.render, "static");
});

test("isEcommerceUrl detects known storefronts and ignores others", () => {
  assert.equal(isEcommerceUrl("https://www.amazon.com/"), true);
  assert.equal(isEcommerceUrl("https://smile.amazon.co.uk/gp/x"), true);
  assert.equal(isEcommerceUrl("https://www.ebay.com/itm/123"), true);
  assert.equal(isEcommerceUrl("https://www.etsy.com/listing/1"), true);
  assert.equal(isEcommerceUrl("https://example.com/docs"), false);
  assert.equal(isEcommerceUrl("not a url"), false);
  // Suffix must be a real domain boundary, not a substring.
  assert.equal(isEcommerceUrl("https://notamazon.com.evil.test/"), false);
});

test("normalizeScrapeArgs routes ecommerce homepages through retail auto path", () => {
  const args = normalizeScrapeArgs({ url: AMAZON_URL });
  assert.equal(args.strategy, "auto");
  assert.equal(args.render, "auto");
  assert.equal(args.proxy, "residential");
  assert.equal(args.response_detail, "standard");
  assert.deepEqual(args.formats, ["markdown"]);
});

test("normalizeScrapeArgs respects explicit strategy on ecommerce url", () => {
  const args = normalizeScrapeArgs({ url: AMAZON_URL, strategy: "download" });
  assert.equal(args.strategy, "download");
});

test("normalizeScrapeArgs respects explicit proxy/render on ecommerce url", () => {
  const args = normalizeScrapeArgs({
    url: AMAZON_URL,
    proxy: "datacenter",
    render: "static",
  });
  assert.equal(args.strategy, "auto");
  assert.equal(args.proxy, "datacenter");
  assert.equal(args.render, "static");
});
