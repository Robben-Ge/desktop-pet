#!/usr/bin/env node
const http = require("node:http");

const DEFAULT_API_BASE = "http://127.0.0.1:17861";
const MAX_STDIN_BYTES = 1024 * 256;

function parseArgs(argv) {
  const out = {};
  for (let index = 2; index < argv.length; index += 1) {
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

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) {
        reject(new Error("hook stdin is too large"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function parsePayload(raw) {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function postJson(url, payload, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length
      },
      timeout: timeoutMs
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode || 0));
    });
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function stdoutForHook(source, event) {
  if (source === "codex") return "{}";
  if (source === "codebuddy") {
    if (event === "PreToolUse") return JSON.stringify({ decision: "allow" });
    return "{}";
  }
  return "";
}

async function main() {
  const args = parseArgs(process.argv);
  const source = String(args.source || "manual");
  const event = args.event ? String(args.event) : "";
  const apiBase = String(args.api || process.env.DESKTOP_PET_AGENT_API || DEFAULT_API_BASE).replace(/\/+$/, "");

  try {
    const payload = parsePayload(await readStdin());
    const hookSource = payload.source;
    payload.source = source;
    if (hookSource !== undefined) payload.hook_source = hookSource;
    if (event && !payload.hook_event_name && !payload.event) payload.hook_event_name = event;
    if (args.pet && !payload.petKey && !payload.petId) payload.petKey = String(args.pet);

    await postJson(`${apiBase}/events`, payload);
  } catch (error) {
    if (process.env.DESKTOP_PET_AGENT_HOOK_DEBUG === "1") {
      process.stderr.write(`desktop-pet-agent hook ignored error: ${error.message}\n`);
    }
  } finally {
    const stdout = stdoutForHook(source, event);
    if (stdout) process.stdout.write(stdout);
  }
}

main().catch(() => {
  const args = parseArgs(process.argv);
  const stdout = stdoutForHook(String(args.source || "manual"), args.event ? String(args.event) : "");
  if (stdout) process.stdout.write(stdout);
});
