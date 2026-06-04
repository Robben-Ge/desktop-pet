#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARKER = "--desktop-pet-agent-managed";
const API_BASE = "http://127.0.0.1:17861";

const AGENT_CONFIGS = {
  "claude-code": {
    label: "Claude Code",
    settingsPath: () => path.join(os.homedir(), ".claude", "settings.json"),
    format: "claude",
    source: "claude-code",
    events: ["UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure"]
  },
  codebuddy: {
    label: "CodeBuddy",
    settingsPath: () => path.join(os.homedir(), ".codebuddy", "settings.json"),
    format: "claude",
    source: "codebuddy",
    events: [
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Notification",
      "PreCompact",
      "Stop"
    ]
  },
  codex: {
    label: "Codex",
    settingsPath: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks.json"),
    format: "codex",
    source: "codex",
    events: [
      "SessionStart",
      "SubagentStart",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "PreCompact",
      "PostCompact",
      "UserPromptSubmit",
      "SubagentStop",
      "Stop"
    ]
  }
};

function parseArgs(argv) {
  const out = { command: argv[2] || "preview", agent: "all" };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    index += 1;
  }
  return out;
}

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return parsed;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupPath = `${filePath}.desktop-pet-agent-backup-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_@%+=:,./\\-]+$/.test(value)) return value;
  if (/[\r\n"\0]/.test(value)) throw new Error(`Unsupported command path: ${value}`);
  return `"${value}"`;
}

function buildBridgeCommand(agent, event, options = {}) {
  const nodeBin = options.nodeBin || process.execPath;
  const bridgePath = path.join(__dirname, "hook-bridge.js");
  const apiBase = options.apiBase || API_BASE;
  return [
    shellQuote(nodeBin),
    shellQuote(bridgePath),
    "--source",
    agent.source,
    "--event",
    event,
    "--api",
    apiBase,
    MARKER
  ].join(" ");
}

function containsManagedHook(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.command === "string" && value.command.includes(MARKER)) return true;
  if (typeof value.commandWindows === "string" && value.commandWindows.includes(MARKER)) return true;
  if (Array.isArray(value.hooks)) return value.hooks.some(containsManagedHook);
  return false;
}

function removeManagedHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object") return { settings, removed: 0 };
  const hooks = { ...settings.hooks };
  let removed = 0;

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const cleaned = [];
    for (const entry of entries) {
      if (containsManagedHook(entry)) {
        removed += 1;
        continue;
      }
      cleaned.push(entry);
    }
    if (cleaned.length > 0) hooks[event] = cleaned;
    else delete hooks[event];
  }

  return {
    settings: { ...settings, hooks },
    removed
  };
}

function createClaudeHookEntry(command) {
  return {
    hooks: [{
      type: "command",
      command,
      timeout: 3,
      async: true,
      asyncRewake: false
    }]
  };
}

function codexMatcherForEvent(event) {
  if (event === "SessionStart") return "startup|resume|clear|compact";
  if (event === "PreCompact" || event === "PostCompact") return "manual|auto";
  if (event === "PreToolUse" || event === "PermissionRequest" || event === "PostToolUse") return ".*";
  if (event === "SubagentStart" || event === "SubagentStop") return ".*";
  return "";
}

function createCodexHookEntry(command, event) {
  const entry = {
    hooks: [{
      type: "command",
      command,
      commandWindows: command,
      timeout: 3,
      statusMessage: "Notify desktop pet"
    }]
  };
  const matcher = codexMatcherForEvent(event);
  if (matcher) entry.matcher = matcher;
  return entry;
}

function installHooks(agentId, options = {}) {
  const agent = resolveAgent(agentId);
  const settingsPath = options.settingsPath || agent.settingsPath();
  const existing = readJsonObject(settingsPath);
  const { settings: withoutManaged, removed } = removeManagedHooks(existing);
  const hooks = withoutManaged.hooks && typeof withoutManaged.hooks === "object"
    ? { ...withoutManaged.hooks }
    : {};

  let added = 0;
  for (const event of agent.events) {
    const command = buildBridgeCommand(agent, event, options);
    const entry = agent.format === "codex"
      ? createCodexHookEntry(command, event)
      : createClaudeHookEntry(command);
    hooks[event] = Array.isArray(hooks[event]) ? [...hooks[event], entry] : [entry];
    added += 1;
  }

  const next = { ...withoutManaged, hooks };
  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  let backupPath = null;
  if (!options.preview && changed) {
    backupPath = backupFile(settingsPath);
    writeJsonAtomic(settingsPath, next);
  }

  return {
    agent: agentId,
    label: agent.label,
    settingsPath,
    changed,
    added,
    removed,
    backupPath,
    preview: next
  };
}

function uninstallHooks(agentId, options = {}) {
  const agent = resolveAgent(agentId);
  const settingsPath = options.settingsPath || agent.settingsPath();
  const existing = readJsonObject(settingsPath);
  const { settings: next, removed } = removeManagedHooks(existing);
  const changed = removed > 0;
  let backupPath = null;
  if (!options.preview && changed) {
    backupPath = backupFile(settingsPath);
    writeJsonAtomic(settingsPath, next);
  }

  return {
    agent: agentId,
    label: agent.label,
    settingsPath,
    changed,
    removed,
    backupPath,
    preview: next
  };
}

function doctorHooks(agentId, options = {}) {
  const agent = resolveAgent(agentId);
  const settingsPath = options.settingsPath || agent.settingsPath();
  let settings = {};
  let valid = true;
  let error = "";
  try {
    settings = readJsonObject(settingsPath);
  } catch (err) {
    valid = false;
    error = err.message;
  }
  const hooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  const missing = agent.events.filter((event) => {
    const entries = hooks[event];
    return !Array.isArray(entries) || !entries.some(containsManagedHook);
  });

  return {
    agent: agentId,
    label: agent.label,
    settingsPath,
    exists: fs.existsSync(settingsPath),
    valid,
    status: valid && missing.length === 0 ? "installed" : (valid ? "not_installed" : "error"),
    missing,
    error
  };
}

function resolveAgent(agentId) {
  const normalized = String(agentId || "").toLowerCase();
  const id = normalized === "claude" ? "claude-code" : normalized;
  const agent = AGENT_CONFIGS[id];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}

function resolveAgentIds(value) {
  const normalized = String(value || "all").toLowerCase();
  if (normalized === "all") return Object.keys(AGENT_CONFIGS);
  const id = normalized === "claude" ? "claude-code" : normalized;
  resolveAgent(id);
  return [id];
}

function runCommand(args) {
  const ids = resolveAgentIds(args.agent);
  const options = {
    apiBase: args.api || API_BASE,
    nodeBin: args.node,
    preview: args.command === "preview" || args.command === "doctor"
  };

  if (args.settings) {
    if (ids.length !== 1) throw new Error("--settings can only be used with one --agent");
    options.settingsPath = path.resolve(String(args.settings));
  }

  if (args.command === "doctor") return ids.map((id) => doctorHooks(id, options));
  if (args.command === "preview") return ids.map((id) => installHooks(id, options));
  if (args.command === "install") return ids.map((id) => installHooks(id, options));
  if (args.command === "uninstall") return ids.map((id) => uninstallHooks(id, options));
  throw new Error(`Unknown command: ${args.command}`);
}

if (require.main === module) {
  try {
    const result = runCommand(parseArgs(process.argv));
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  AGENT_CONFIGS,
  MARKER,
  buildBridgeCommand,
  doctorHooks,
  installHooks,
  uninstallHooks,
  runCommand
};
