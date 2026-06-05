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

test("settings keeps pet library controls before app updates", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "settings.html"), "utf8");
  const petListIndex = html.indexOf('id="petList"');
  const updatePanelIndex = html.indexOf('id="updatePanel"');

  assert.match(html, /id="petSourceTabs"/);
  assert.match(html, /id="reloadPetsBtn"/);
  assert.ok(petListIndex > -1);
  assert.ok(updatePanelIndex > -1);
  assert.ok(petListIndex < updatePanelIndex);
});
