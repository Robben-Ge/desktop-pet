/**
 * Daily greeting — configurable tasks, each fires at most once per day.
 */

const { pickLoveMessage } = require("./love-messages");

const POLL_INTERVAL_MS = 30_000;
const GREETING_SCHEMA_VERSION = 2;

const DEFAULT_GREETING_TASKS = [
  { id: "startup", label: "启动时", kind: "startup", enabled: true, time: "" },
  { id: "morning", label: "9点", kind: "scheduled", enabled: true, time: "09:00" },
  { id: "noon", label: "12点", kind: "scheduled", enabled: true, time: "12:00" },
  { id: "evening", label: "18点", kind: "scheduled", enabled: true, time: "18:00" },
  { id: "night", label: "21点", kind: "scheduled", enabled: true, time: "21:00" }
];

function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeKind(kind) {
  return kind === "startup" ? "startup" : "scheduled";
}

function normalizeTask(task) {
  if (!task || !task.id) return null;
  const kind = normalizeKind(task.kind);
  return {
    id: String(task.id),
    label: String(task.label || (kind === "startup" ? "启动时" : "定时问候")).slice(0, 40),
    kind,
    enabled: task.enabled !== false,
    time: kind === "scheduled" ? (task.time || "09:00") : ""
  };
}

function isCustomGreetingTaskId(id) {
  return id.startsWith("greeting-") || (id !== "legacy-scheduled" && !DEFAULT_GREETING_TASKS.some((task) => task.id === id));
}

function shouldUpgradeGreetingTasks(greeting, tasks) {
  if (greeting.mode) return true;
  if (tasks.some((task) => task.id === "legacy-scheduled")) return true;
  if (greeting.schemaVersion === GREETING_SCHEMA_VERSION) return false;
  if (tasks.some((task) => isCustomGreetingTaskId(task.id))) return false;
  return tasks.length < DEFAULT_GREETING_TASKS.length;
}

function upgradeGreetingTasks(tasks) {
  const existing = new Map(tasks.map((task) => [task.id, task]));
  return DEFAULT_GREETING_TASKS.map((defaults) => {
    const kept = existing.get(defaults.id);
    return kept
      ? { ...defaults, ...kept, id: defaults.id, kind: defaults.kind }
      : { ...defaults };
  });
}

function migrateGreetingConfig(greeting = {}) {
  let tasks = Array.isArray(greeting.tasks)
    ? greeting.tasks.map(normalizeTask).filter(Boolean)
    : [];

  if (!tasks.length) {
    if (greeting.mode === "scheduled" && greeting.scheduledTime) {
      tasks = [{
        id: "legacy-scheduled",
        label: "定时",
        kind: "scheduled",
        enabled: true,
        time: greeting.scheduledTime
      }];
    } else if (greeting.mode === "first-boot" || greeting.mode === "both") {
      tasks = [
        { id: "startup", label: "启动时", kind: "startup", enabled: true, time: "" },
        ...(greeting.mode === "both" && greeting.scheduledTime
          ? [{ id: "legacy-scheduled", label: "定时", kind: "scheduled", enabled: true, time: greeting.scheduledTime }]
          : [])
      ];
    } else {
      tasks = DEFAULT_GREETING_TASKS.map((task) => ({ ...task }));
    }
  }

  let upgraded = false;
  if (shouldUpgradeGreetingTasks(greeting, tasks)) {
    tasks = upgradeGreetingTasks(tasks);
    upgraded = true;
  }

  const lastTriggered = greeting.lastTriggered && typeof greeting.lastTriggered === "object"
    ? { ...greeting.lastTriggered }
    : {};

  const today = todayString();
  if (greeting.lastFirstBootDate === today && !lastTriggered.startup) {
    lastTriggered.startup = today;
  }
  if (greeting.lastScheduledDate === today) {
    const scheduledTask = tasks.find((task) => task.kind === "scheduled");
    if (scheduledTask && !lastTriggered[scheduledTask.id]) {
      lastTriggered[scheduledTask.id] = today;
    }
  }
  if (greeting.lastTriggered?.["legacy-scheduled"]) {
    const legacyTask = Array.isArray(greeting.tasks)
      ? greeting.tasks.find((task) => task.id === "legacy-scheduled")
      : null;
    const legacyTime = legacyTask?.time || greeting.scheduledTime || "09:00";
    const mappedId = DEFAULT_GREETING_TASKS.find(
      (task) => task.kind === "scheduled" && task.time === legacyTime
    )?.id || "morning";
    lastTriggered[mappedId] = greeting.lastTriggered["legacy-scheduled"];
    delete lastTriggered["legacy-scheduled"];
  }

  return {
    schemaVersion: GREETING_SCHEMA_VERSION,
    enabled: greeting.enabled !== false,
    tasks,
    lastTriggered,
    lastMessageId: greeting.lastMessageId || null,
    upgraded
  };
}

class DailyGreetingManager {
  #config;
  #saveCallback;
  #onGreet;
  #timer;
  #startupHandled = false;

  constructor({ greeting, save, onGreet } = {}) {
    this.#saveCallback = save || (() => {});
    this.#onGreet = onGreet || (() => {});
    this.#config = migrateGreetingConfig(greeting);
    if (this.#config.upgraded) {
      const { upgraded, ...config } = this.#config;
      this.#config = config;
      this.#saveCallback(this.getConfig());
    } else {
      delete this.#config.upgraded;
    }
    this.#timer = null;
  }

  getConfig() {
    return {
      schemaVersion: GREETING_SCHEMA_VERSION,
      enabled: this.#config.enabled,
      tasks: this.#config.tasks.map((task) => ({ ...task })),
      lastTriggered: { ...this.#config.lastTriggered },
      lastMessageId: this.#config.lastMessageId
    };
  }

  getStatus() {
    const today = todayString();
    return {
      enabled: this.#config.enabled,
      tasks: this.#config.tasks.map((task) => ({
        ...task,
        triggeredToday: this.#config.lastTriggered[task.id] === today
      }))
    };
  }

  updateConfig(patch = {}) {
    if (typeof patch.enabled === "boolean") {
      this.#config.enabled = patch.enabled;
    }

    if (Array.isArray(patch.tasks)) {
      for (const patchTask of patch.tasks) {
        const idx = this.#config.tasks.findIndex((task) => task.id === patchTask.id);

        if (patchTask.__delete) {
          if (idx !== -1) {
            const removed = this.#config.tasks[idx];
            this.#config.tasks.splice(idx, 1);
            delete this.#config.lastTriggered[removed.id];
          }
          continue;
        }

        if (idx === -1) {
          const created = normalizeTask({
            kind: "scheduled",
            enabled: true,
            time: "09:00",
            ...patchTask
          });
          if (created) this.#config.tasks.push(created);
          continue;
        }

        this.#config.tasks[idx] = normalizeTask({
          ...this.#config.tasks[idx],
          ...patchTask
        }) || this.#config.tasks[idx];
      }
    }

    this.#saveCallback(this.getConfig());
    return { ok: true, dailyGreeting: this.getStatus() };
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.#tickScheduled(), POLL_INTERVAL_MS);
    if (typeof this.#timer.unref === "function") this.#timer.unref();
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  tryStartupTasks() {
    if (this.#startupHandled) return 0;
    this.#startupHandled = true;
    if (!this.#config.enabled) return 0;

    let count = 0;
    for (const task of this.#config.tasks) {
      if (task.kind !== "startup" || !task.enabled) continue;
      if (this.#fireTask(task)) count += 1;
    }
    return count;
  }

  triggerTask(taskId) {
    if (!this.#config.enabled) return false;
    const task = this.#config.tasks.find((item) => item.id === taskId);
    if (!task || !task.enabled) return false;
    return this.#fireTask(task);
  }

  #tickScheduled() {
    if (!this.#config.enabled) return;

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    for (const task of this.#config.tasks) {
      if (task.kind !== "scheduled" || !task.enabled || task.time !== hhmm) continue;
      this.#fireTask(task);
    }
  }

  #fireTask(task) {
    const today = todayString();
    if (this.#config.lastTriggered[task.id] === today) return false;

    const picked = pickLoveMessage({
      reason: task.kind === "startup" ? "first-boot" : "scheduled",
      date: new Date(),
      scheduledTime: task.time || "09:00",
      excludeId: this.#config.lastMessageId
    });

    this.#config.lastTriggered[task.id] = today;
    this.#config.lastMessageId = picked.id;
    this.#saveCallback(this.getConfig());
    this.#onGreet({
      message: picked.text,
      type: picked.type,
      id: picked.id,
      taskId: task.id,
      taskLabel: task.label
    });
    return true;
  }

  sayNow() {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const picked = pickLoveMessage({
      reason: "scheduled",
      date: now,
      scheduledTime: hhmm,
      excludeId: this.#config.lastMessageId
    });

    this.#config.lastMessageId = picked.id;
    this.#saveCallback(this.getConfig());
    this.#onGreet({
      message: picked.text,
      type: picked.type,
      id: picked.id,
      taskId: "manual",
      taskLabel: "手动"
    });
    return { ok: true, message: picked.text, type: picked.type };
  }
}

module.exports = {
  DailyGreetingManager,
  DEFAULT_GREETING_TASKS,
  GREETING_SCHEMA_VERSION,
  migrateGreetingConfig,
  normalizeTask,
  shouldUpgradeGreetingTasks,
  todayString
};
