const fs = require("node:fs");
const path = require("node:path");

const MESSAGES_PATH = path.join(__dirname, "assets", "love_messages.json");

const TYPE_POOLS = {
  morning: ["早安", "日常", "关心"],
  noon: ["日常", "关心", "夸夸"],
  afternoon: ["日常", "想念", "撒娇", "暧昧"],
  evening: ["关心", "日常", "想念", "晚安"],
  night: ["晚安", "想念"]
};

const ALL_TYPES = ["日常", "想念", "撒娇", "夸夸", "关心", "早安", "晚安", "暧昧"];

let cachedMessages = null;

function loadLoveMessages() {
  if (cachedMessages) return cachedMessages;
  try {
    const raw = JSON.parse(fs.readFileSync(MESSAGES_PATH, "utf8"));
    cachedMessages = Array.isArray(raw)
      ? raw.filter((item) => item && String(item.text || "").trim())
      : [];
  } catch {
    cachedMessages = [];
  }
  return cachedMessages;
}

function hourBand(hour) {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function parseHour(timeStr, fallback = 9) {
  const hour = parseInt(String(timeStr || "").split(":")[0], 10);
  return Number.isFinite(hour) ? hour : fallback;
}

/**
 * Pick message types by trigger reason and clock time.
 * - first-boot: use current hour
 * - scheduled: use configured greeting time
 */
function resolveTypesForGreeting({ reason = "first-boot", date = new Date(), scheduledTime = "09:00" } = {}) {
  const hour = reason === "scheduled" ? parseHour(scheduledTime, date.getHours()) : date.getHours();
  return TYPE_POOLS[hourBand(hour)] || TYPE_POOLS.morning;
}

function pickLoveMessage(options = {}) {
  const messages = loadLoveMessages();
  if (!messages.length) {
    return { id: 0, type: "日常", text: "今天也要开开心心的。" };
  }

  const preferredTypes = Array.isArray(options.allowedTypes) && options.allowedTypes.length
    ? options.allowedTypes
    : resolveTypesForGreeting(options);

  let pool = messages.filter((item) => preferredTypes.includes(item.type));
  if (!pool.length) pool = messages;

  if (options.excludeId) {
    const withoutLast = pool.filter((item) => item.id !== options.excludeId);
    if (withoutLast.length) pool = withoutLast;
  }

  const picked = pool[Math.floor(Math.random() * pool.length)] || messages[0];
  return {
    id: picked.id,
    type: picked.type,
    text: String(picked.text).trim()
  };
}

function getLoveMessageStats() {
  const messages = loadLoveMessages();
  const byType = {};
  for (const type of ALL_TYPES) byType[type] = 0;
  for (const item of messages) {
    byType[item.type] = (byType[item.type] || 0) + 1;
  }
  return { total: messages.length, byType, types: ALL_TYPES };
}

module.exports = {
  ALL_TYPES,
  TYPE_POOLS,
  loadLoveMessages,
  resolveTypesForGreeting,
  pickLoveMessage,
  getLoveMessageStats,
  hourBand
};
