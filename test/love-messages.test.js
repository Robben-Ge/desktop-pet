const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveTypesForGreeting,
  pickLoveMessage,
  getLoveMessageStats
} = require("../src/love-messages");

test("getLoveMessageStats summarizes bundled library", () => {
  const stats = getLoveMessageStats();
  assert.ok(stats.total >= 300);
  assert.ok(stats.byType["早安"] >= 20);
  assert.ok(stats.byType["晚安"] >= 20);
});

test("pickLoveMessage avoids immediate repeat when possible", () => {
  const first = pickLoveMessage({ allowedTypes: ["日常"] });
  const second = pickLoveMessage({ allowedTypes: ["日常"], excludeId: first.id });
  if (getLoveMessageStats().byType["日常"] > 1) {
    assert.notEqual(first.id, second.id);
  }
});

test("resolveTypesForGreeting covers afternoon band", () => {
  const types = resolveTypesForGreeting({
    reason: "first-boot",
    date: new Date("2026-09-03T16:00:00")
  });
  assert.deepEqual(types, ["日常", "想念", "撒娇", "暧昧"]);
});
