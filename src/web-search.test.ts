import assert from "node:assert/strict";
import test from "node:test";
import { buildWebSearchRequest, formatWebSearchResponse, WEB_SEARCH_RESULT_LIMIT } from "./web-search.js";

test("buildWebSearchRequest always uses top-10 limit and defaults language to en", () => {
  assert.equal(WEB_SEARCH_RESULT_LIMIT, 10);
  assert.deepEqual(buildWebSearchRequest({ query: "docker docs" }), {
    query: "docker docs",
    language: "en",
    limit: 10,
  });
  assert.deepEqual(
    buildWebSearchRequest({ query: "news", categories: ["news"], language: "en" }),
    { query: "news", categories: ["news"], language: "en", limit: 10 }
  );
});

test("formatWebSearchResponse renders readable snippets", () => {
  const text = formatWebSearchResponse({
    query: "docker docs",
    credits_charged: 2,
    results: [
      {
        title: "Docker Docs",
        url: "https://docs.docker.com/",
        snippet: "Official Docker documentation.",
      },
    ],
  });
  assert.match(text, /Status: success/);
  assert.match(text, /Query: docker docs/);
  assert.match(text, /Docker Docs/);
  assert.match(text, /Next: Answer simple questions from snippets/);
});
