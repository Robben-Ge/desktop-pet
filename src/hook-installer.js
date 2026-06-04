#!/usr/bin/env node
const fs = require("node:fs");
const childProcess = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const MARKER = "--desktop-pet-agent-managed";
const API_BASE = "http://127.0.0.1:17861";

const AGENT_CONFIGS = {
  "claude-code": {
    label: "Claude Code",
    settingsPath: () => path.join(os.homedir(), ".claude", "settings.json"),
    format: "claude",
    useArgs: true,
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
    configPath: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml"),
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

function buildBridgeCommandParts(agent, event, options = {}) {
  const nodeBin = options.nodeBin || resolveNodeBin();
  const bridgePath = path.join(__dirname, "hook-bridge.js");
  const apiBase = options.apiBase || API_BASE;
  return {
    nodeBin,
    bridgePath,
    args: [
      bridgePath,
      "--source",
      agent.source,
      "--event",
      event,
      "--api",
      apiBase,
      MARKER
    ]
  };
}

function buildBridgeCommand(agent, event, options = {}) {
  const parts = buildBridgeCommandParts(agent, event, options);
  return [
    shellQuote(parts.nodeBin),
    ...parts.args.map((arg) => {
      if (arg === "--source" || arg === "--event" || arg === "--api" || arg === MARKER) return arg;
      return shellQuote(arg);
    })
  ].join(" ");
}

function resolveNodeBin() {
  const candidates = [
    process.env.DESKTOP_PET_AGENT_NODE,
    process.env.NODE_REPL_NODE_PATH,
    process.execPath,
    ...findNodeOnPath()
  ].filter(Boolean);

  for (const candidate of candidates) {
    const base = path.basename(String(candidate)).toLowerCase();
    if (base === "node.exe" || base === "node") return String(candidate);
  }

  return "node";
}

function findNodeOnPath() {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = childProcess.execFileSync(command, ["node"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function managedHookUsesNode(value) {
  if (!value || typeof value !== "object") return true;
  for (const key of ["command", "commandWindows"]) {
    const command = value[key];
    if (typeof command === "string" && command.includes(MARKER)) {
      return /(?:^|[\\/"'\s])node(?:\.exe)?(?:["'\s]|$)/i.test(command) && !/electron(?:\.exe)?/i.test(command);
    }
  }
  if (typeof value.command === "string" && hasManagedArgs(value)) {
    const base = path.basename(value.command).toLowerCase();
    return (base === "node.exe" || base === "node") && !/electron(?:\.exe)?/i.test(value.command);
  }
  if (Array.isArray(value.hooks)) return value.hooks.every(managedHookUsesNode);
  return true;
}

function containsManagedHook(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.command === "string" && value.command.includes(MARKER)) return true;
  if (typeof value.commandWindows === "string" && value.commandWindows.includes(MARKER)) return true;
  if (hasManagedArgs(value)) return true;
  if (Array.isArray(value.hooks)) return value.hooks.some(containsManagedHook);
  return false;
}

function hasManagedArgs(value) {
  return Array.isArray(value?.args) && value.args.some((arg) => String(arg).includes(MARKER));
}

function managedHookUsesArgs(value) {
  if (!value || typeof value !== "object") return false;
  if (hasManagedArgs(value)) return true;
  if (typeof value.command === "string" && value.command.includes(MARKER)) return false;
  if (typeof value.commandWindows === "string" && value.commandWindows.includes(MARKER)) return false;
  if (Array.isArray(value.hooks)) return value.hooks.some(managedHookUsesArgs);
  return false;
}

function managedHookMatchesAgent(agent, value) {
  if (!containsManagedHook(value) || !managedHookUsesNode(value)) return false;
  if (agent.useArgs) return managedHookUsesArgs(value);
  return true;
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

function createClaudeHookEntry(agent, event, options = {}) {
  if (agent.useArgs) {
    const parts = buildBridgeCommandParts(agent, event, options);
    return {
      hooks: [{
        type: "command",
        command: parts.nodeBin,
        args: parts.args,
        timeout: 3,
        async: true,
        asyncRewake: false
      }]
    };
  }

  const command = buildBridgeCommand(agent, event, options);
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
      : createClaudeHookEntry(agent, event, options);
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

  let codexConfig = null;
  if (!options.preview && agent.format === "codex") {
    codexConfig = ensureCodexHooksFeature(agent, options);
  }

  return {
    agent: agentId,
    label: agent.label,
    settingsPath,
    changed,
    added,
    removed,
    backupPath,
    codexConfig,
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
    return !Array.isArray(entries) || !entries.some((entry) => managedHookMatchesAgent(agent, entry));
  });
  const invalidCommands = countInvalidManagedCommands(hooks);
  const codexFeature = agent.format === "codex" ? getCodexHooksFeature(agent, options) : null;
  const missingFeature = codexFeature && codexFeature.enabled !== true;

  return {
    agent: agentId,
    label: agent.label,
    settingsPath,
    exists: fs.existsSync(settingsPath),
    valid,
    status: valid && missing.length === 0 && invalidCommands === 0 && !missingFeature
      ? "installed"
      : (valid ? "not_installed" : "error"),
    missing,
    invalidCommands,
    codexFeature,
    error
  };
}

function countInvalidManagedCommands(hooks) {
  let count = 0;
  if (!hooks || typeof hooks !== "object") return count;
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (containsManagedHook(entry) && !managedHookUsesNode(entry)) count += 1;
    }
  }
  return count;
}

function getCodexHooksFeature(agent, options = {}) {
  const configPath = options.configPath || agent.configPath?.();
  if (!configPath) return null;
  if (!fs.existsSync(configPath)) {
    return { configPath, exists: false, enabled: false };
  }

  const text = fs.readFileSync(configPath, "utf8");
  const section = findTomlSection(text, "features");
  if (!section) return { configPath, exists: true, enabled: false };
  const body = text.slice(section.bodyStart, section.bodyEnd);
  const match = body.match(/^\s*hooks\s*=\s*(true|false)\s*(?:#.*)?$/mi);
  return {
    configPath,
    exists: true,
    enabled: match ? match[1] === "true" : false
  };
}

function ensureCodexHooksFeature(agent, options = {}) {
  const configPath = options.configPath || agent.configPath?.();
  if (!configPath) return null;

  let text = "";
  if (fs.existsSync(configPath)) text = fs.readFileSync(configPath, "utf8");
  const next = setTomlFeature(text, "hooks", "true");
  if (next === text) {
    return { configPath, changed: false, backupPath: null };
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const backupPath = backupFile(configPath);
  fs.writeFileSync(configPath, next, "utf8");
  return { configPath, changed: true, backupPath };
}

function setTomlFeature(text, key, value) {
  const normalized = text || "";
  const section = findTomlSection(normalized, "features");
  const line = `${key} = ${value}`;

  if (!section) {
    const prefix = normalized && !normalized.endsWith("\n") ? `${normalized}\n\n` : normalized;
    return `${prefix}[features]\n${line}\n`;
  }

  const before = normalized.slice(0, section.bodyStart);
  const body = normalized.slice(section.bodyStart, section.bodyEnd);
  const after = normalized.slice(section.bodyEnd);
  const regex = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*=\\s*(true|false)(\\s*(?:#.*)?)$`, "mi");

  if (regex.test(body)) {
    const nextBody = body.replace(regex, `$1${key} = ${value}$3`);
    return `${before}${nextBody}${after}`;
  }

  const separator = body.endsWith("\n") || body.length === 0 ? "" : "\n";
  return `${before}${body}${separator}${line}\n${after}`;
}

function findTomlSection(text, name) {
  const sectionRegex = /^\s*\[([^\]]+)\]\s*$/gm;
  let match;
  while ((match = sectionRegex.exec(text)) !== null) {
    if (match[1].trim() !== name) continue;
    const bodyStart = sectionRegex.lastIndex;
    const next = sectionRegex.exec(text);
    return {
      headerStart: match.index,
      bodyStart,
      bodyEnd: next ? next.index : text.length
    };
  }
  return null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
