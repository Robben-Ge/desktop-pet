const test = require("node:test");
const assert = require("node:assert/strict");
const { getCursorProbeDispatch } = require("../src/cursor-probe");

test("stationary inside cursor probes keep dispatching while the pet animates", () => {
  const point = { x: 120, y: 160, inside: true };
  const first = getCursorProbeDispatch(point, null);
  const second = getCursorProbeDispatch(point, first.key);

  assert.equal(first.key, "inside");
  assert.equal(first.shouldSend, true);
  assert.equal(second.key, "inside");
  assert.equal(second.shouldSend, true);
});

test("repeated outside cursor probes collapse to one dispatch", () => {
  const first = getCursorProbeDispatch({ x: -1, y: -1, inside: false }, null);
  const second = getCursorProbeDispatch({ x: 800, y: 600, inside: false }, first.key);

  assert.equal(first.key, "outside");
  assert.equal(first.shouldSend, true);
  assert.equal(second.key, "outside");
  assert.equal(second.shouldSend, false);
});

test("reset probe state dispatches the first outside point again", () => {
  assert.equal(getCursorProbeDispatch({ inside: false }, null).shouldSend, true);
});
