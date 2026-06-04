const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const API_HOST = "127.0.0.1";
const API_PORT = Number(process.env.PET_PORT || 17861);
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const PETS_DIR = path.join(CODEX_HOME, "pets");
const PET_RUNS_DIR = path.join(CODEX_HOME, "pet-runs");
const BASE_WINDOW_WIDTH = 240;
const BASE_WINDOW_HEIGHT = 286;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.4;
const MIN_BUBBLE_SCALE = 0.75;
const MAX_BUBBLE_SCALE = 1.6;

const VALID_STATES = new Set([
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
  "start",
  "remind",
  "success",
  "done",
  "sleeping",
  "working",
  "thinking"
]);

let win;
let bubbleWin;
let settingsWin;
let tray;
let server;
let pets = [];
let activePet = null;
let settings = {};
let stateBeforeDrag = null;
let bubbleTimer = null;
let bubbleReady = false;
let pendingBubblePayload = null;
let currentState = {
  state: "idle",
  normalizedState: "idle",
  message: "Ready",
  updatedAt: new Date().toISOString()
};

const ACTIONS = [
  { state: "idle", label: "idle 待机", row: 0, hookName: "idle" },
  { state: "running-right", label: "向右拖拽移动", row: 1, hookName: "drag-right" },
  { state: "running-left", label: "向左拖拽移动", row: 2, hookName: "drag-left" },
  { state: "waving", label: "挥手/提醒", row: 3, hookName: "remind" },
  { state: "jumping", label: "done 开心跳一下", row: 4, hookName: "done" },
  { state: "failed", label: "sleeping 趴下睡觉", row: 5, hookName: "sleeping" },
  { state: "waiting", label: "waiting 等待输入", row: 6, hookName: "waiting" },
  { state: "running", label: "working 敲代码中", row: 7, hookName: "working" },
  { state: "review", label: "thinking 歪头思考", row: 8, hookName: "thinking" }
];

const STATE_ALIASES = {
  start: "waving",
  remind: "waving",
  success: "jumping",
  done: "jumping",
  sleeping: "failed",
  working: "running",
  thinking: "review"
};

function normalizeState(state) {
  const requested = String(state || "idle");
  return STATE_ALIASES[requested] || requested;
}

function clampZoom(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function clampBubbleScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_BUBBLE_SCALE, Math.min(MAX_BUBBLE_SCALE, value));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  settings = readJson(getSettingsPath()) || {};
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.warn(`Failed to save settings: ${error.message}`);
  }
}

function listDirectories(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function toPetPayload(pet) {
  if (!pet) return null;
  return {
    id: pet.id,
    key: pet.key,
    displayName: pet.displayName,
    description: pet.description,
    source: pet.source,
    root: pet.root,
    spritesheetPath: pet.spritesheetPath,
    spritesheetUrl: pathToFileURL(pet.spritesheetPath).toString()
  };
}

function discoverInstalledPets() {
  return listDirectories(PETS_DIR)
    .map((dir) => {
      const manifest = readJson(path.join(dir, "pet.json")) || {};
      const id = String(manifest.id || path.basename(dir));
      const spritesheetPath = path.resolve(dir, manifest.spritesheetPath || "spritesheet.webp");

      if (!fs.existsSync(spritesheetPath)) return null;

      return {
        id,
        key: `pets:${id}`,
        displayName: String(manifest.displayName || id),
        description: String(manifest.description || ""),
        source: "pets",
        root: dir,
        spritesheetPath
      };
    })
    .filter(Boolean);
}

function discoverRunPets() {
  return listDirectories(PET_RUNS_DIR)
    .map((dir) => {
      const request = readJson(path.join(dir, "pet_request.json")) || {};
      const id = String(request.pet_id || path.basename(dir));
      const spritesheetPath = path.join(dir, "final", "spritesheet.webp");

      if (!fs.existsSync(spritesheetPath)) return null;

      return {
        id,
        key: `pet-runs:${id}`,
        displayName: String(request.display_name || id),
        description: String(request.description || ""),
        source: "pet-runs",
        root: dir,
        spritesheetPath
      };
    })
    .filter(Boolean);
}

function discoverPets() {
  const installed = discoverInstalledPets();
  const runs = discoverRunPets();
  pets = [...installed, ...runs];

  const preferred = process.env.PET_ID || settings.activePetKey;
  activePet = pets.find((pet) => pet.id === preferred || pet.key === preferred) || pets[0] || null;
}

function createWindow() {
  const savedBounds = settings.windowBounds || {};
  const zoom = clampZoom(settings.zoom || 1);
  win = new BrowserWindow({
    width: Math.round(BASE_WINDOW_WIDTH * zoom),
    height: Math.round(BASE_WINDOW_HEIGHT * zoom),
    x: Number.isFinite(savedBounds.x) ? savedBounds.x : 40,
    y: Number.isFinite(savedBounds.y) ? savedBounds.y : 220,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, "floating");
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    win = null;
  });
}

function createBubbleWindow() {
  bubbleReady = false;
  bubbleWin = new BrowserWindow({
    width: 280,
    height: 96,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  bubbleWin.setAlwaysOnTop(true, "floating");
  bubbleWin.setIgnoreMouseEvents(true);
  bubbleWin.loadFile(path.join(__dirname, "renderer", "bubble.html"));
  bubbleWin.webContents.once("did-finish-load", () => {
    bubbleReady = true;
    if (pendingBubblePayload) {
      bubbleWin.webContents.send("bubble:set-message", pendingBubblePayload);
      pendingBubblePayload = null;
    }
  });
  bubbleWin.on("closed", () => {
    bubbleWin = null;
    bubbleReady = false;
  });
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 880,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: "Desktop Pet Settings",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

function sendToWindows(channel, payload) {
  for (const target of [win, settingsWin]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send(channel, payload);
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionBubble(size = {}) {
  if (!win || win.isDestroyed() || !bubbleWin || bubbleWin.isDestroyed()) return;

  const petBounds = win.getBounds();
  const display = screen.getDisplayMatching(petBounds);
  const area = display.workArea;
  const gap = 10;
  const margin = 8;
  const width = Math.ceil(Number(size.width) || 280);
  const height = Math.ceil(Number(size.height) || 96);
  const petCenterX = petBounds.x + petBounds.width / 2;
  const topY = petBounds.y - height - gap;
  const bottomY = petBounds.y + petBounds.height + gap;

  const x = clamp(
    Math.round(petCenterX - width / 2),
    area.x + margin,
    area.x + area.width - width - margin
  );
  const y = topY >= area.y + margin
    ? topY
    : clamp(bottomY, area.y + margin, area.y + area.height - height - margin);

  bubbleWin.setBounds({ x, y, width, height });
}

function showBubble(message) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  clearTimeout(bubbleTimer);

  if (!message) {
    bubbleWin.hide();
    return;
  }

  const payload = {
    message,
    bubbleScale: clampBubbleScale(settings.bubbleScale || 1)
  };

  positionBubble();
  bubbleWin.showInactive();

  if (bubbleReady) {
    bubbleWin.webContents.send("bubble:set-message", payload);
  } else {
    pendingBubblePayload = payload;
  }

  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  }, 4200);
}

function broadcastZoom() {
  sendToWindows("pet:set-zoom", {
    zoom: clampZoom(settings.zoom || 1),
    bounds: win && !win.isDestroyed() ? win.getBounds() : null
  });
}

function broadcastBubbleScale() {
  sendToWindows("pet:set-bubble-scale", {
    bubbleScale: clampBubbleScale(settings.bubbleScale || 1)
  });
  if (currentState.message) {
    showBubble(currentState.message);
  }
}

function broadcastState(nextState) {
  const requestedState = nextState.state || currentState.state;
  const normalizedState = normalizeState(requestedState);
  currentState = {
    ...currentState,
    ...nextState,
    state: requestedState,
    normalizedState,
    updatedAt: new Date().toISOString()
  };

  sendToWindows("pet:set-state", {
    ...currentState,
    actions: ACTIONS,
    activePet: toPetPayload(activePet)
  });
  showBubble(currentState.message);
}

function broadcastPet() {
  sendToWindows("pet:set-pet", toPetPayload(activePet));
}

function selectPet(idOrKey, source) {
  const nextPet = pets.find((pet) => {
    if (source && pet.source !== source) return false;
    return pet.id === idOrKey || pet.key === idOrKey;
  });

  if (!nextPet) return false;
  activePet = nextPet;
  settings.activePetKey = nextPet.key;
  saveSettings();
  broadcastPet();
  return true;
}

function buildInitialPayload() {
  return {
    ...currentState,
    normalizedState: normalizeState(currentState.state),
    pets: pets.map(toPetPayload),
    actions: ACTIONS,
    activePet: toPetPayload(activePet),
    config: {
      apiBaseUrl: `http://${API_HOST}:${API_PORT}`,
      petsRoot: PETS_DIR,
      petRunsRoot: PET_RUNS_DIR,
      settingsPath: getSettingsPath(),
      zoom: clampZoom(settings.zoom || 1),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      bubbleScale: clampBubbleScale(settings.bubbleScale || 1),
      minBubbleScale: MIN_BUBBLE_SCALE,
      maxBubbleScale: MAX_BUBBLE_SCALE,
      baseWindowWidth: BASE_WINDOW_WIDTH,
      baseWindowHeight: BASE_WINDOW_HEIGHT
    }
  };
}

function resizePetWindow(zoomInput) {
  if (!win || win.isDestroyed()) return { ok: false };
  const zoom = clampZoom(zoomInput);
  const bounds = win.getBounds();
  const width = Math.round(BASE_WINDOW_WIDTH * zoom);
  const height = Math.round(BASE_WINDOW_HEIGHT * zoom);
  win.setBounds({ x: bounds.x, y: bounds.y, width, height });
  settings.zoom = zoom;
  settings.windowBounds = win.getBounds();
  saveSettings();
  broadcastZoom();
  positionBubble();
  return { ok: true, zoom, bounds: win.getBounds() };
}

function resizeBubble(scaleInput) {
  const bubbleScale = clampBubbleScale(scaleInput);
  settings.bubbleScale = bubbleScale;
  saveSettings();
  broadcastBubbleScale();
  return { ok: true, bubbleScale };
}

function getWindowPlacement() {
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const edgeMargin = 48;

  return {
    bounds,
    workArea,
    nearLeft: bounds.x <= workArea.x + edgeMargin,
    nearRight: bounds.x + bounds.width >= workArea.x + workArea.width - edgeMargin,
    nearTop: bounds.y <= workArea.y + edgeMargin,
    nearBottom: bounds.y + bounds.height >= workArea.y + workArea.height - edgeMargin
  };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

async function handleApiRequest(req, res) {
  const url = new URL(req.url, `http://${API_HOST}:${API_PORT}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      state: currentState,
      actions: ACTIONS,
      activePet: toPetPayload(activePet),
      petsRoot: PETS_DIR,
      petRunsRoot: PET_RUNS_DIR
    });
    return;
  }

  if (url.pathname === "/pets" && req.method === "GET") {
    discoverPets();
    sendJson(res, 200, {
      ok: true,
      actions: ACTIONS,
      activePet: toPetPayload(activePet),
      pets: pets.map(toPetPayload)
    });
    return;
  }

  if (url.pathname === "/actions" && req.method === "GET") {
    sendJson(res, 200, { ok: true, actions: ACTIONS });
    return;
  }

  if (url.pathname === "/settings/open" && req.method === "POST") {
    createSettingsWindow();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/window/resize" && req.method === "POST") {
    const body = await parseJsonBody(req);
    sendJson(res, 200, resizePetWindow(body.zoom));
    return;
  }

  if (url.pathname === "/bubble/resize" && req.method === "POST") {
    const body = await parseJsonBody(req);
    sendJson(res, 200, resizeBubble(body.bubbleScale || body.scale));
    return;
  }

  if (url.pathname === "/pet/select" && req.method === "POST") {
    const body = await parseJsonBody(req);
    if (!selectPet(String(body.id || body.key || ""), body.source)) {
      sendJson(res, 404, { ok: false, error: "Pet not found" });
      return;
    }
    sendJson(res, 200, { ok: true, activePet: toPetPayload(activePet) });
    return;
  }

  if (url.pathname === "/state" && req.method === "GET") {
    sendJson(res, 200, {
      ...currentState,
      activePet: toPetPayload(activePet)
    });
    return;
  }

  if (url.pathname === "/state" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const state = typeof body.state === "string" ? body.state : "idle";
      const message = typeof body.message === "string" ? body.message.slice(0, 120) : "";
      const durationMs = Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : 0;

      if (body.petId || body.petKey) {
        selectPet(String(body.petId || body.petKey), body.petSource);
      }

      if (!VALID_STATES.has(state)) {
        sendJson(res, 400, {
          ok: false,
          error: `Invalid state. Use one of: ${Array.from(VALID_STATES).join(", ")}`
        });
        return;
      }

      broadcastState({ state, message });

      if (durationMs > 0) {
        setTimeout(() => {
          if (currentState.state === state) {
            broadcastState({ state: "idle", message: "Ready" });
          }
        }, Math.min(durationMs, 60_000));
      }

      sendJson(res, 200, {
        ok: true,
        state: currentState,
        activePet: toPetPayload(activePet)
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

function createApiServer() {
  server = http.createServer((req, res) => {
    handleApiRequest(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
  });

  server.listen(API_PORT, API_HOST, () => {
    console.log(`Desktop pet API listening on http://${API_HOST}:${API_PORT}`);
  });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAGFBMVEUAAAAYIi9i5v9y8qaZfP/90WYfKz2xyNj28m6BAAAAB3RSTlMA///f39+fn6uU/gAAAEFJREFUeNqVj0kOwCAIBQO//2XnplkYQYJGk0BHyDKJg1xmEAjJQWYNZUdGgTYosAkfiBPwYQnKN3qHf6Snw6gudTW2DdqgAhoBA3kwAAAAAElFTkSuQmCC"
  );
  tray = new Tray(icon);
  tray.setToolTip("Desktop Pet Agent");
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Show / Hide",
      click: () => {
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
      }
    },
    {
      label: "Settings",
      click: () => createSettingsWindow()
    },
    {
      type: "separator"
    },
    {
      label: "Idle",
      click: () => broadcastState({ state: "idle", message: "Ready" })
    },
    {
      label: "Running",
      click: () => broadcastState({ state: "running", message: "Task running" })
    },
    {
      label: "Waiting",
      click: () => broadcastState({ state: "waiting", message: "Waiting for input" })
    },
    {
      label: "Quit",
      click: () => app.quit()
    }
  ]));
}

app.whenReady().then(() => {
  loadSettings();
  discoverPets();
  createWindow();
  createBubbleWindow();
  createTray();
  createApiServer();

  ipcMain.handle("pet:get-initial-state", () => buildInitialPayload());
  ipcMain.handle("pet:list-pets", () => {
    discoverPets();
    return {
      ok: true,
      pets: pets.map(toPetPayload),
      activePet: toPetPayload(activePet),
      actions: ACTIONS
    };
  });
  ipcMain.handle("pet:select-pet", (_event, payload) => {
    const ok = selectPet(String(payload?.id || payload?.key || ""), payload?.source);
    return { ok, activePet: toPetPayload(activePet), pets: pets.map(toPetPayload) };
  });
  ipcMain.handle("pet:set-state", (_event, payload) => {
    const state = String(payload?.state || "idle");
    if (!VALID_STATES.has(state)) return { ok: false, error: "Invalid state" };
    broadcastState({
      state,
      message: typeof payload?.message === "string" ? payload.message.slice(0, 120) : ""
    });
    return { ok: true, state: currentState };
  });
  ipcMain.handle("pet:get-window-bounds", () => {
    if (!win || win.isDestroyed()) return null;
    return win.getBounds();
  });
  ipcMain.handle("pet:get-window-placement", () => getWindowPlacement());
  ipcMain.handle("pet:move-window", (_event, point) => {
    if (!win || win.isDestroyed() || !point) return false;
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    win.setPosition(x, y);
    positionBubble();
    return true;
  });
  ipcMain.handle("pet:resize-window", (_event, payload) => {
    return resizePetWindow(payload?.zoom);
  });
  ipcMain.handle("pet:resize-bubble", (_event, payload) => {
    return resizeBubble(payload?.bubbleScale || payload?.scale);
  });
  ipcMain.handle("bubble:measure", (_event, size) => {
    positionBubble(size);
    if (bubbleWin && !bubbleWin.isDestroyed() && currentState.message) {
      bubbleWin.showInactive();
    }
    return true;
  });
  ipcMain.handle("pet:finish-drag", () => {
    if (win && !win.isDestroyed()) {
      settings.windowBounds = win.getBounds();
      saveSettings();
    }

    if (stateBeforeDrag) {
      broadcastState(stateBeforeDrag);
      stateBeforeDrag = null;
    } else {
      broadcastState({ state: "idle", message: "" });
    }
    return true;
  });
  ipcMain.on("pet:drag-direction", (_event, state) => {
    if (!["running-left", "running-right"].includes(state)) return;
    if (!stateBeforeDrag) stateBeforeDrag = { ...currentState };
    if (normalizeState(currentState.state) !== state) {
      broadcastState({ state, message: "" });
    }
  });
  ipcMain.on("pet:open-settings", () => createSettingsWindow());
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  if (server) server.close();
});
