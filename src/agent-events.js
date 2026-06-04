const AGENTS = {
  "claude-code": { label: "Claude Code", aliases: ["claude", "claude_code", "claude-code"] },
  codex: { label: "Codex", aliases: ["codex", "codex-cli", "openai-codex"] },
  codebuddy: { label: "CodeBuddy", aliases: ["codebuddy", "code-buddy"] },
  opencode: { label: "OpenCode", aliases: ["opencode", "open-code"] },
  openpets: { label: "OpenPets", aliases: ["openpets", "open-pets"] }
};

const SOURCE_ALIASES = Object.entries(AGENTS).reduce((aliases, [id, agent]) => {
  aliases[id] = id;
  for (const alias of agent.aliases) aliases[alias] = id;
  return aliases;
}, {});

const REACTION_TO_STATE = {
  idle: "idle",
  thinking: "review",
  working: "running",
  editing: "running",
  running: "running",
  testing: "waiting",
  waiting: "waiting",
  waving: "waving",
  success: "jumping",
  done: "jumping",
  error: "failed",
  failed: "failed",
  celebrating: "jumping"
};

const EVENT_ALIASES = {
  sessionstart: "session_start",
  session_start: "session_start",
  start: "task_start",
  taskstart: "task_start",
  task_start: "task_start",
  userpromptsubmit: "prompt",
  prompt: "prompt",
  thinking: "thinking",
  review: "review",
  pretooluse: "tool_start",
  toolstart: "tool_start",
  tool_start: "tool_start",
  posttooluse: "tool_end",
  posttoolfailure: "tool_failed",
  posttoolusefailure: "tool_failed",
  toolend: "tool_end",
  tool_end: "tool_end",
  permissionrequest: "waiting",
  permission: "waiting",
  waiting: "waiting",
  notification: "notification",
  remind: "notification",
  stop: "done",
  taskend: "done",
  task_end: "done",
  success: "done",
  done: "done",
  stopfailure: "failed",
  fail: "failed",
  failed: "failed",
  error: "failed",
  sessionend: "session_end",
  session_end: "session_end",
  idle: "idle"
};

function normalizeAgentSource(value) {
  const key = String(value || "manual").trim().toLowerCase();
  return SOURCE_ALIASES[key] || key || "manual";
}

function getAgentLabel(source) {
  return AGENTS[source]?.label || source;
}

function normalizeEventName(value) {
  const raw = String(value || "").trim();
  const key = raw.toLowerCase().replace(/[\s.-]+/g, "_").replace(/_/g, "");
  return EVENT_ALIASES[raw.toLowerCase()] || EVENT_ALIASES[key] || raw.toLowerCase();
}

function pickSource(payload) {
  return normalizeAgentSource(
    payload.source ||
    payload.agent ||
    payload.agentId ||
    payload.agent_id ||
    (payload.hook_event_name ? "claude-code" : "")
  );
}

function pickEvent(payload) {
  return normalizeEventName(
    payload.event ||
    payload.type ||
    payload.name ||
    payload.hook_event_name ||
    payload.reaction ||
    payload.state
  );
}

function pickSessionId(payload, source) {
  const value = payload.sessionId || payload.session_id || payload.conversationId ||
    payload.taskId || payload.task_id || payload.cwd || payload.project || "default";
  return `${source}:${String(value).slice(0, 160)}`;
}

function pickMessage(payload, fallback) {
  const message = payload.message || payload.text || payload.title || payload.summary;
  if (typeof message === "string" && message.trim()) return message.trim().slice(0, 120);
  return fallback;
}

function isTestCommand(command) {
  return /\b(test|vitest|jest|pytest|cargo test|go test|npm test|pnpm test|yarn test)\b/i.test(command);
}

function classifyToolState(payload) {
  const toolName = String(payload.tool_name || payload.toolName || payload.tool || "").toLowerCase();
  const command = String(payload.tool_input?.command || payload.toolInput?.command || payload.command || "");

  if (["edit", "write", "multiedit", "notebookedit"].includes(toolName)) return "running";
  if (toolName === "bash" || toolName === "shell" || toolName === "terminal") {
    return isTestCommand(command) ? "waiting" : "running";
  }
  return "running";
}

function buildDecision(payload) {
  const source = pickSource(payload);
  const event = pickEvent(payload);
  const label = getAgentLabel(source);
  const sessionId = pickSessionId(payload, source);

  if (payload.reaction && REACTION_TO_STATE[payload.reaction]) {
    const state = REACTION_TO_STATE[payload.reaction];
    return {
      source,
      event: String(payload.reaction),
      sessionId,
      persistentState: state,
      message: pickMessage(payload, defaultMessage(label, state))
    };
  }

  if (event === "session_start") {
    return {
      source,
      event,
      sessionId,
      persistentState: "review",
      visualState: "waving",
      durationMs: 1800,
      message: pickMessage(payload, `${label} 开始任务`)
    };
  }

  if (event === "task_start" || event === "prompt" || event === "thinking") {
    return {
      source,
      event,
      sessionId,
      persistentState: "review",
      message: pickMessage(payload, `${label} 正在思考`)
    };
  }

  if (event === "tool_start") {
    const state = classifyToolState(payload);
    return {
      source,
      event,
      sessionId,
      persistentState: state,
      message: pickMessage(payload, state === "waiting" ? `${label} 正在跑检查` : `${label} 正在执行工具`)
    };
  }

  if (event === "tool_end" || event === "review") {
    return {
      source,
      event,
      sessionId,
      persistentState: "review",
      message: pickMessage(payload, `${label} 正在整理结果`)
    };
  }

  if (event === "waiting") {
    return {
      source,
      event,
      sessionId,
      persistentState: "waiting",
      message: pickMessage(payload, `${label} 等待确认`)
    };
  }

  if (event === "notification") {
    return {
      source,
      event,
      sessionId,
      visualState: "waving",
      durationMs: 2200,
      message: pickMessage(payload, `${label} 有新提醒`)
    };
  }

  if (event === "done") {
    return {
      source,
      event,
      sessionId,
      terminal: true,
      visualState: "jumping",
      durationMs: 2600,
      message: pickMessage(payload, `${label} 任务完成`)
    };
  }

  if (event === "failed" || event === "tool_failed") {
    return {
      source,
      event,
      sessionId,
      terminal: true,
      visualState: "failed",
      durationMs: 3200,
      message: pickMessage(payload, `${label} 任务失败`)
    };
  }

  if (event === "session_end" || event === "idle") {
    return {
      source,
      event,
      sessionId,
      terminal: true,
      visualState: "idle",
      durationMs: 0,
      message: pickMessage(payload, "")
    };
  }

  return null;
}

function defaultMessage(label, state) {
  if (state === "review") return `${label} 正在思考`;
  if (state === "running") return `${label} 正在执行任务`;
  if (state === "waiting") return `${label} 等待确认`;
  if (state === "waving") return `${label} 有新提醒`;
  if (state === "jumping") return `${label} 任务完成`;
  if (state === "failed") return `${label} 任务失败`;
  return "";
}

module.exports = {
  AGENTS,
  REACTION_TO_STATE,
  buildDecision,
  getAgentLabel,
  normalizeAgentSource,
  normalizeEventName
};
