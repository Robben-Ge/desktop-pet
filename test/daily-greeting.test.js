const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DailyGreetingManager,
  DEFAULT_GREETING_TASKS,
  migrateGreetingConfig,
  todayString
} = require("../src/daily-greeting");

test("migrateGreetingConfig defaults to five greeting tasks", () => {
  const config = migrateGreetingConfig({});
  assert.equal(config.tasks.length, 5);
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(config.tasks.map((task) => task.label), ["启动时", "9点", "12点", "18点", "21点"]);
  assert.deepEqual(
    config.tasks.map((task) => (task.kind === "startup" ? "startup" : task.time)),
    ["startup", "09:00", "12:00", "18:00", "21:00"]
  );
});

test("migrateGreetingConfig upgrades legacy two-task config to five defaults", () => {
  const config = migrateGreetingConfig({
    enabled: true,
    tasks: [
      { id: "startup", label: "启动时", kind: "startup", enabled: true, time: "" },
      { id: "legacy-scheduled", label: "定时", kind: "scheduled", enabled: true, time: "09:00" }
    ],
    lastTriggered: { startup: "2026-09-03", "legacy-scheduled": "2026-09-03" }
  });

  assert.equal(config.tasks.length, 5);
  assert.equal(config.upgraded, true);
  assert.equal(config.lastTriggered.startup, "2026-09-03");
  assert.equal(config.lastTriggered.morning, "2026-09-03");
  assert.equal(config.lastTriggered["legacy-scheduled"], undefined);
});

test("DailyGreetingManager persists upgraded greeting tasks", () => {
  const saved = [];
  const manager = new DailyGreetingManager({
    greeting: {
      enabled: true,
      tasks: [
        { id: "startup", label: "启动时", kind: "startup", enabled: true, time: "" },
        { id: "legacy-scheduled", label: "定时", kind: "scheduled", enabled: true, time: "09:00" }
      ]
    },
    save: (config) => saved.push(config),
    onGreet: () => {}
  });

  assert.equal(manager.getConfig().tasks.length, 5);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].schemaVersion, 2);
});

test("DailyGreetingManager fires each scheduled task once per day", () => {
  const greeted = [];
  const manager = new DailyGreetingManager({
    greeting: { enabled: true, tasks: DEFAULT_GREETING_TASKS.map((task) => ({ ...task })) },
    save: () => {},
    onGreet: (payload) => greeted.push(payload)
  });

  assert.equal(manager.triggerTask("morning"), true);
  assert.equal(manager.triggerTask("noon"), true);
  assert.equal(manager.triggerTask("evening"), true);
  assert.equal(manager.triggerTask("night"), true);
  assert.equal(greeted.length, 4);
  assert.equal(manager.triggerTask("morning"), false);
});

test("DailyGreetingManager supports startup tasks", () => {
  const greeted = [];
  const manager = new DailyGreetingManager({
    greeting: {
      enabled: true,
      tasks: [{ id: "startup", label: "启动时", kind: "startup", enabled: true, time: "" }]
    },
    save: () => {},
    onGreet: (payload) => greeted.push(payload)
  });

  assert.equal(manager.tryStartupTasks(), 1);
  assert.equal(manager.tryStartupTasks(), 0);
  assert.equal(greeted[0].taskId, "startup");
});

test("updateConfig can add and delete greeting tasks", () => {
  const saved = [];
  const manager = new DailyGreetingManager({
    greeting: { enabled: true, tasks: DEFAULT_GREETING_TASKS.map((task) => ({ ...task })) },
    save: (config) => saved.push(config),
    onGreet: () => {}
  });

  manager.updateConfig({
    tasks: [{ id: "tea", label: "下午茶", kind: "scheduled", enabled: true, time: "15:00" }]
  });
  assert.equal(manager.getConfig().tasks.length, 6);

  manager.updateConfig({ tasks: [{ id: "noon", __delete: true }] });
  assert.equal(manager.getConfig().tasks.length, 5);
  assert.ok(saved.length >= 2);
});

test("trigger marks task as triggered today", () => {
  const manager = new DailyGreetingManager({
    greeting: { enabled: true, tasks: DEFAULT_GREETING_TASKS.map((task) => ({ ...task })) },
    save: () => {},
    onGreet: () => {}
  });

  manager.triggerTask("morning");
  assert.equal(manager.getStatus().tasks.find((task) => task.id === "morning").triggeredToday, true);
  assert.equal(manager.getConfig().lastTriggered.morning, todayString());
});

test("sayNow speaks immediately without consuming task quota", () => {
  const greeted = [];
  const manager = new DailyGreetingManager({
    greeting: { enabled: false, tasks: DEFAULT_GREETING_TASKS.map((task) => ({ ...task })) },
    save: () => {},
    onGreet: (payload) => greeted.push(payload)
  });

  const result = manager.sayNow();
  assert.equal(result.ok, true);
  assert.match(result.message, /\S/);
  assert.equal(greeted.length, 1);
  assert.equal(greeted[0].taskId, "manual");
  assert.equal(manager.getConfig().lastTriggered.morning, undefined);
});
