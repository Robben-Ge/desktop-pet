const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("pet renderer markup keeps the visible stage mounted", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");

  assert.match(html, /<main class="stage"[^>]*>/);
  assert.match(html, /id="pet"/);
  assert.match(html, /id="sprite"/);
  assert.doesNotMatch(html, /<!--[\s\S]*<main class="stage"[\s\S]*-->/);
});
