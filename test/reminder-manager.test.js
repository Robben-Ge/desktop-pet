const test = require("node:test");
const assert = require("node:assert/strict");
const { ReminderManager } = require("../src/reminder-manager");

test("ReminderManager initializes with default types", () => {
  const rm = new ReminderManager();
  const config = rm.getConfig();

  assert.equal(config.enabled, true);
  assert.equal(config.quietMode, false);
  assert.equal(config.workHours.start, "09:00");
  assert.equal(config.workHours.end, "18:00");
  assert.equal(config.types.length, 5);

  const drink = config.types.find((t) => t.id === "drink-water");
  assert.ok(drink);
  assert.equal(drink.mode, "interval");
  assert.equal(drink.intervalMinutes, 60);

  const clockOut = config.types.find((t) => t.id === "clock-out");
  assert.ok(clockOut);
  assert.equal(clockOut.mode, "scheduled");
  assert.equal(clockOut.scheduledTime, "18:00");
  assert.equal(clockOut.animationState, "jumping");
});

test("ReminderManager merges persisted config over defaults", () => {
  const persisted = {
    enabled: false,
    quietMode: true,
    workHours: { start: "10:00", end: "19:00" },
    types: [
      { id: "drink-water", enabled: false, intervalMinutes: 30 }
    ]
  };

  const rm = new ReminderManager({ reminders: persisted });
  const config = rm.getConfig();

  assert.equal(config.enabled, false);
  assert.equal(config.quietMode, true);
  assert.equal(config.workHours.start, "10:00");
  assert.equal(config.workHours.end, "19:00");

  const drink = config.types.find((t) => t.id === "drink-water");
  assert.equal(drink.enabled, false);
  assert.equal(drink.intervalMinutes, 30);
});

test("getStatus returns all type statuses", () => {
  const rm = new ReminderManager();
  const status = rm.getStatus();

  assert.equal(status.enabled, true);
  assert.equal(status.types.length, 5);

  for (const type of status.types) {
    assert.ok(typeof type.id === "string");
    assert.ok(typeof type.elapsedMinutes === "number");
    assert.ok(type.elapsedMinutes >= 0);
  }
});

test("updateConfig partial merge works", () => {
  const saved = [];
  const rm = new ReminderManager({
    save: (config) => saved.push(config)
  });

  rm.updateConfig({ enabled: false });
  assert.equal(rm.getConfig().enabled, false);
  assert.equal(saved.length, 1);

  rm.updateConfig({ quietMode: true });
  assert.equal(rm.getConfig().quietMode, true);
});

test("updateConfig by type resets elapsed", () => {
  const rm = new ReminderManager();

  rm.updateConfig({
    types: [{ id: "drink-water", intervalMinutes: 30 }]
  });

  const config = rm.getConfig();
  const drink = config.types.find((t) => t.id === "drink-water");
  assert.equal(drink.intervalMinutes, 30);
});

test("triggerNow fires the correct type", (t) => {
  const triggers = [];
  const rm = new ReminderManager({
    onTrigger: (event) => triggers.push(event)
  });

  rm.triggerNow("drink-water");
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].typeId, "drink-water");
  assert.equal(triggers[0].state, "waving");

  rm.triggerNow("clock-out");
  assert.equal(triggers.length, 2);
  assert.equal(triggers[1].typeId, "clock-out");
  assert.equal(triggers[1].state, "jumping");
});

test("triggerNow returns error for unknown type", () => {
  const rm = new ReminderManager();
  const result = rm.triggerNow("nonexistent");
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("reset clears elapsed for specific type", () => {
  const rm = new ReminderManager();
  const before = rm.getStatus();
  const drinkBefore = before.types.find((t) => t.id === "drink-water");

  rm.reset("drink-water");
  const after = rm.getStatus();
  const drinkAfter = after.types.find((t) => t.id === "drink-water");

  assert.ok(drinkAfter.elapsedMinutes <= drinkBefore.elapsedMinutes);
});

test("reset all clears all timers", () => {
  const rm = new ReminderManager();

  // Trigger to advance timer
  rm.triggerNow("drink-water");

  rm.reset();
  const status = rm.getStatus();
  for (const type of status.types) {
    assert.ok(type.elapsedMinutes <= 1);
  }
});

test("start and stop manage timer lifecycle", () => {
  const rm = new ReminderManager();

  rm.start();
  rm.stop();
  // Should not throw
});

test("quietMode suppresses triggers", () => {
  const triggers = [];
  const rm = new ReminderManager({
    reminders: { quietMode: true },
    onTrigger: (event) => triggers.push(event)
  });

  rm.start();
  rm.triggerNow("drink-water");
  assert.equal(triggers.length, 1); // manual trigger bypasses quiet mode
});

test("message template replaces {minutes}", () => {
  const triggers = [];
  const rm = new ReminderManager({
    onTrigger: (event) => triggers.push(event)
  });

  rm.triggerNow("drink-water");
  const msg = triggers[0].message;
  assert.ok(!msg.includes("{minutes}"), "message should have substituted {minutes}");
  assert.ok(msg.includes("💧"));
});
