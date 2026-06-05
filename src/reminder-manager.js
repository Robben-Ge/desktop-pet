/**
 * Reminder Manager — standalone timer-based reminder engine.
 *
 * Two trigger modes:
 *  - "interval": fires when elapsed time >= intervalMinutes (cooldown after each trigger).
 *  - "scheduled": fires once per day when clock time matches scheduledTime (e.g. "18:00").
 *
 * Publishes via callback: { typeId, label, state, message, durationSeconds }
 */

const DEFAULT_REMINDER_TYPES = [
  {
    id: "drink-water",
    label: "喝水",
    mode: "interval",
    enabled: true,
    intervalMinutes: 45,
    message: "该喝水啦！已经 {minutes} 分钟没喝水了 💧",
    animationState: "waving",
    durationSeconds: 15
  },
  {
    id: "stretch",
    label: "久坐",
    mode: "interval",
    enabled: true,
    intervalMinutes: 70,
    message: "坐太久啦！起来活动一下吧 🧘",
    animationState: "waving",
    durationSeconds: 15
  },
  {
    id: "rest-eyes",
    label: "护眼",
    mode: "interval",
    enabled: true,
    intervalMinutes: 45,
    message: "看看远处，让眼睛休息一下 👀",
    animationState: "waving",
    durationSeconds: 15
  },
  {
    id: "take-break",
    label: "摸鱼",
    mode: "interval",
    enabled: true,
    intervalMinutes: 60,
    message: "休息一下，看看窗外放松放松 ☕",
    animationState: "waving",
    durationSeconds: 15
  },
  {
    id: "clock-out",
    label: "下班",
    mode: "scheduled",
    enabled: true,
    scheduledTime: "18:00",
    message: "到点啦！收拾收拾下班吧 🎉",
    animationState: "jumping",
    durationSeconds: 20
  }
];

const POLL_INTERVAL_MS = 30_000;       // 30s polling
const COOLDOWN_MS = 30_000;           // 30s cooldown after trigger

const State = Object.freeze({
  IDLE: "idle",
  WAITING: "waiting",
  TRIGGERED: "triggered",
  COOLDOWN: "cooldown"
});

class ReminderManager {
  #config;
  #saveCallback;
  #triggerCallback;
  #timer;
  #startedAt;

  /**
   * @param {object} options
   * @param {object} [options.reminders] - persisted { enabled, quietMode, workHours, types[] }
   * @param {function} options.save - (config) => void — persist config
   * @param {function} options.onTrigger - ({ typeId, label, state, message, durationSeconds }) => void
   * @param {function} [options.getCurrentPetState] - () => string — returns current pet animation state
   */
  constructor({ reminders, save, onTrigger } = {}) {
    this.#saveCallback = save || (() => {});
    this.#triggerCallback = onTrigger || (() => {});

    // Seed config with defaults merged over persisted data
    const persistedTypes = Array.isArray(reminders?.types) ? reminders.types : [];
    const defaultIds = new Set(DEFAULT_REMINDER_TYPES.map((t) => t.id));

    // Merge defaults with persisted
    const mergedTypes = DEFAULT_REMINDER_TYPES.map((def) => {
      const saved = persistedTypes.find((t) => t.id === def.id) || {};
      return {
        ...def,
        enabled: saved.enabled !== undefined ? saved.enabled : def.enabled,
        intervalMinutes: saved.intervalMinutes || def.intervalMinutes,
        scheduledTime: saved.scheduledTime || def.scheduledTime,
        message: saved.message || def.message,
        animationState: saved.animationState || def.animationState,
        durationSeconds: saved.durationSeconds || def.durationSeconds
      };
    });

    // Append persisted custom types not in defaults
    for (const saved of persistedTypes) {
      if (!defaultIds.has(saved.id)) {
        mergedTypes.push({
          mode: "interval",
          animationState: "waving",
          durationSeconds: 5,
          enabled: true,
          intervalMinutes: 60,
          message: "",
          ...saved
        });
      }
    }

    this.#config = {
      enabled: reminders?.enabled !== false,
      quietMode: Boolean(reminders?.quietMode),
      workHours: {
        start: reminders?.workHours?.start || "09:00",
        end: reminders?.workHours?.end || "18:00"
      },
      types: mergedTypes
    };

    // Runtime state per type
    this.#startedAt = {};
    const now = Date.now();
    for (const type of this.#config.types) {
      this.#startedAt[type.id] = {
        lastTriggeredAt: now,
        state: State.IDLE,
        cooldownUntil: 0,
        triggeredToday: null  // "YYYY-MM-DD" for scheduled mode
      };
    }

    this.#timer = null;
  }

  // ---- public API ----

  getConfig() {
    return this.#config;
  }

  /**
   * Update config (partial merge). Resets elapsed for changed types.
   */
  updateConfig(patch) {
    if (!patch) return;

    if (typeof patch.enabled === "boolean") {
      this.#config.enabled = patch.enabled;
    }
    if (typeof patch.quietMode === "boolean") {
      this.#config.quietMode = patch.quietMode;
    }
    if (patch.workHours) {
      if (typeof patch.workHours.start === "string") {
        this.#config.workHours.start = patch.workHours.start;
      }
      if (typeof patch.workHours.end === "string") {
        this.#config.workHours.end = patch.workHours.end;
      }
    }

    if (Array.isArray(patch.types)) {
      for (const patchType of patch.types) {
        const idx = this.#config.types.findIndex((t) => t.id === patchType.id);

        // Delete: remove type and its runtime state
        if (patchType.__delete) {
          if (idx !== -1) {
            const deleted = this.#config.types[idx];
            this.#config.types.splice(idx, 1);
            delete this.#startedAt[deleted.id];
          }
          continue;
        }

        // Add new type
        if (idx === -1) {
          const newType = {
            mode: patchType.mode || "interval",
            animationState: patchType.animationState || "waving",
            durationSeconds: patchType.durationSeconds ?? 5,
            ...patchType
          };
          // Ensure required fields
          if (newType.mode === "scheduled" && !newType.scheduledTime) {
            newType.scheduledTime = "18:00";
          }
          if (newType.mode === "interval" && newType.intervalMinutes == null) {
            newType.intervalMinutes = 60;
          }
          if (!newType.enabled && newType.enabled !== false) {
            newType.enabled = true;
          }
          this.#config.types.push(newType);
          this.#startedAt[newType.id] = {
            lastTriggeredAt: Date.now(),
            state: State.IDLE,
            cooldownUntil: 0,
            triggeredToday: null
          };
          continue;
        }

        const old = this.#config.types[idx];

        const changed = (
          patchType.enabled !== undefined && patchType.enabled !== old.enabled
        ) || (
          patchType.intervalMinutes !== undefined && patchType.intervalMinutes !== old.intervalMinutes
        ) || (
          patchType.scheduledTime !== undefined && patchType.scheduledTime !== old.scheduledTime
        );

        // Merge all properties including animationState and durationSeconds
        this.#config.types[idx] = { ...old, ...patchType };

        if (changed) {
          // Reset timer for this type
          this.#startedAt[old.id].lastTriggeredAt = Date.now();
          this.#startedAt[old.id].state = State.WAITING;
          this.#startedAt[old.id].cooldownUntil = 0;
        }
      }
    }

    this.#saveCallback(this.#config);
    return { ok: true };
  }

  /**
   * Manually trigger a specific reminder type.
   */
  triggerNow(typeId) {
    const type = this.#config.types.find((t) => t.id === typeId);
    if (!type) return { ok: false, error: `Unknown reminder type: ${typeId}` };

    this.#fireReminder(type);
    return { ok: true };
  }

  /**
   * Reset elapsed timer for a type (or all).
   */
  reset(typeId) {
    const now = Date.now();
    if (typeId) {
      if (this.#startedAt[typeId]) {
        this.#startedAt[typeId].lastTriggeredAt = now;
        this.#startedAt[typeId].state = State.WAITING;
        this.#startedAt[typeId].cooldownUntil = 0;
        this.#startedAt[typeId].triggeredToday = null;
      }
    } else {
      for (const id of Object.keys(this.#startedAt)) {
        this.#startedAt[id].lastTriggeredAt = now;
        this.#startedAt[id].state = State.WAITING;
        this.#startedAt[id].cooldownUntil = 0;
        this.#startedAt[id].triggeredToday = null;
      }
    }
    return { ok: true };
  }

  /**
   * Returns full status: config + per-type elapsed info.
   */
  getStatus() {
    const now = Date.now();
    const types = this.#config.types.map((type) => {
      const runtime = this.#startedAt[type.id];
      const elapsedMs = now - (runtime?.lastTriggeredAt || now);
      const elapsedMinutes = Math.floor(elapsedMs / 60_000);
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      return {
        id: type.id,
        label: type.label,
        mode: type.mode,
        enabled: type.enabled,
        intervalMinutes: type.intervalMinutes,
        scheduledTime: type.scheduledTime,
        message: type.message || "",
        animationState: type.animationState || "waving",
        durationSeconds: type.durationSeconds ?? 5,
        elapsedMinutes,
        elapsedSeconds,
        state: runtime?.state || State.IDLE,
        cooldownRemaining: Math.max(0, Math.ceil(((runtime?.cooldownUntil || 0) - now) / 1000))
      };
    });

    return {
      enabled: this.#config.enabled,
      quietMode: this.#config.quietMode,
      workHours: this.#config.workHours,
      types
    };
  }

  start() {
    if (this.#timer) return;
    this.#tick(); // first tick immediately to align state
    this.#timer = setInterval(() => this.#tick(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  // ---- private ----

  #tick() {
    if (!this.#config.enabled) return;
    if (this.#config.quietMode) return; // track time but don't fire

    if (!this.#isWithinWorkHours()) return;

    for (const type of this.#config.types) {
      if (!type.enabled) continue;
      this.#checkType(type);
    }
  }

  #checkType(type) {
    const runtime = this.#startedAt[type.id];
    if (!runtime) return;

    // COOLDOWN guard
    if (runtime.state === State.COOLDOWN && Date.now() < runtime.cooldownUntil) return;

    if (type.mode === "interval") {
      this.#checkInterval(type, runtime);
    } else if (type.mode === "scheduled") {
      this.#checkScheduled(type, runtime);
    }
  }

  #checkInterval(type, runtime) {
    const now = Date.now();
    const elapsedMs = now - runtime.lastTriggeredAt;
    const elapsedMinutes = elapsedMs / 60_000;

    if (elapsedMinutes < type.intervalMinutes) return;

    this.#fireReminder(type);
    runtime.lastTriggeredAt = now;
  }

  #checkScheduled(type, runtime) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (runtime.triggeredToday === today) return;

    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (hhmm !== type.scheduledTime) return;

    this.#fireReminder(type);
    runtime.triggeredToday = today;
  }

  #fireReminder(type) {
    const runtime = this.#startedAt[type.id];

    this.#triggerCallback({
      typeId: type.id,
      label: type.label,
      state: type.animationState || "waving",
      message: this.#formatMessage(type),
      durationSeconds: type.durationSeconds || 5
    });

    // Enter cooldown
    runtime.state = State.COOLDOWN;
    runtime.cooldownUntil = Date.now() + COOLDOWN_MS;
    runtime.lastTriggeredAt = Date.now();

    // Auto-return to waiting after cooldown
    setTimeout(() => {
      if (runtime.state === State.COOLDOWN) {
        runtime.state = State.WAITING;
      }
    }, COOLDOWN_MS);
  }

  #formatMessage(type) {
    const elapsedMinutes = Math.floor(
      (Date.now() - (this.#startedAt[type.id]?.lastTriggeredAt || Date.now())) / 60_000
    );
    return (type.message || "").replace(/\{minutes\}/g, String(elapsedMinutes));
  }

  #isWithinWorkHours() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const parseMinutes = (timeStr) => {
      const parts = String(timeStr).split(":");
      return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    };

    const start = parseMinutes(this.#config.workHours.start);
    const end = parseMinutes(this.#config.workHours.end);

    if (start <= end) {
      return currentMinutes >= start && currentMinutes <= end;
    }
    // Overnight shift (e.g., 22:00-06:00)
    return currentMinutes >= start || currentMinutes <= end;
  }
}

module.exports = { ReminderManager, DEFAULT_REMINDER_TYPES };
