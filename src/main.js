const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const {
  discoverPets: discoverPetsInRoot,
  getActivePetsRoot,
  toPetPayload
} = require("./pet-library");
const { ReminderManager } = require("./reminder-manager");
const { DailyGreetingManager } = require("./daily-greeting");

const LOGO_PATH = path.join(__dirname, "assets", "logo.png");
const BUNDLED_PETS_ROOT = path.join(__dirname, "assets", "pets");
const DEFAULT_PET_ID = "danna-graduation";
const RELEASES_URL = "https://github.com/Robben-Ge/desktop-pet/releases";
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
let pets = [];
let activePet = null;
let settings = {};
let stateBeforeDrag = null;
let bubbleTimer = null;
let bubbleReady = false;
let pendingBubblePayload = null;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let updateDownloaded = false;
let updateInstallStarted = false;
let updatePromptVisible = false;
let pendingUpdateInfo = null;
let reminderManager = null;
let dailyGreetingManager = null;
let updateStatus = {
  status: "idle",
  message: "尚未检查更新",
  version: app.getVersion(),
  progress: 0,
  releaseUrl: RELEASES_URL,
  updatedAt: new Date().toISOString()
};
let currentState = {
  state: "idle",
  normalizedState: "idle",
  message: "",
  updatedAt: new Date().toISOString()
};

const ACTIONS = [
  { state: "idle", label: "待机", row: 0 },
  { state: "running-right", label: "向右走", row: 1 },
  { state: "running-left", label: "向左走", row: 2 },
  { state: "waving", label: "挥手", row: 3 },
  { state: "jumping", label: "跳跃", row: 4 },
  { state: "failed", label: "睡觉", row: 5 },
  { state: "waiting", label: "等待", row: 6 },
  { state: "running", label: "忙碌", row: 7 },
  { state: "review", label: "思考", row: 8 }
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

function createAppIcon() {
  try {
    const image = nativeImage.createFromPath(LOGO_PATH);
    if (!image.isEmpty()) return image;
  } catch (error) {
    console.warn(`Failed to load app logo: ${error.message}`);
  }

  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAGFBMVEUAAAAYIi9i5v9y8qaZfP/90WYfKz2xyNj28m6BAAAAB3RSTlMA///f39+fn6uU/gAAAEFJREFUeNqVj0kOwCAIBQO//2XnplkYQYJGk0BHyDKJg1xmEAjJQWYNZUdGgTYosAkfiBPwYQnKN3qHf6Snw6gudTW2DdqgAhoBA3kwAAAAAElFTkSuQmCC"
  );
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

function supportsLoginItemSettings() {
  return process.platform === "win32" || process.platform === "darwin";
}

function getAutoStartEnabled() {
  if (supportsLoginItemSettings()) {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return Boolean(settings.autoStart);
    }
  }
  return Boolean(settings.autoStart);
}

function setAutoStart(enabled) {
  const next = Boolean(enabled);
  settings.autoStart = next;
  saveSettings();

  if (supportsLoginItemSettings()) {
    app.setLoginItemSettings({
      openAtLogin: next,
      path: process.execPath,
      args: []
    });
  }

  rebuildTrayMenu();
  return { ok: true, autoStart: getAutoStartEnabled() };
}

function applyStoredAutoStart() {
  if (!supportsLoginItemSettings()) return;
  const want = Boolean(settings.autoStart);
  try {
    const current = app.getLoginItemSettings().openAtLogin;
    if (want !== current) {
      app.setLoginItemSettings({
        openAtLogin: want,
        path: process.execPath,
        args: []
      });
    }
  } catch (error) {
    console.warn(`Failed to sync auto-start: ${error.message}`);
  }
}

function getLaunchSettingsPayload() {
  return {
    autoStart: getAutoStartEnabled(),
    dailyGreeting: dailyGreetingManager ? dailyGreetingManager.getStatus() : (settings.dailyGreeting || null)
  };
}

function showDailyGreeting({ message }) {
  broadcastState({
    state: "waving",
    message,
    source: "greeting",
    bubbleDurationMs: 12000
  });
  setTimeout(() => {
    broadcastState({ state: "idle", message: "" });
  }, 12000);
}

function discoverPets() {
  const storage = getPetStorageInfo();
  pets = discoverPetsInRoot(storage.petsRoot, { bundledPetsRoot: BUNDLED_PETS_ROOT });
  const preferred = process.env.PET_ID || settings.activePetKey;
  const defaultId = settings.defaultPetId || DEFAULT_PET_ID;
  activePet =
    pets.find((pet) => pet.id === preferred || pet.key === preferred) ||
    pets.find((pet) => pet.id === defaultId || pet.key === `builtin:${defaultId}`) ||
    pets[0] ||
    null;
}

function getPetStorageInfo() {
  return getActivePetsRoot({ settings });
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
    icon: createAppIcon(),
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
    icon: createAppIcon(),
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
    title: "Our Pets 设置",
    autoHideMenuBar: true,
    show: false,
    icon: createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.setMenu(null);
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

function normalizeUpdateInfo(info = {}) {
  return {
    version: info.version || "",
    releaseDate: info.releaseDate || "",
    releaseName: info.releaseName || "",
    releaseNotes: info.releaseNotes || ""
  };
}

function setUpdateStatus(nextStatus) {
  updateStatus = {
    ...updateStatus,
    ...nextStatus,
    version: app.getVersion(),
    releaseUrl: RELEASES_URL,
    updatedAt: new Date().toISOString()
  };
  sendToWindows("pet:update-status", updateStatus);
  return updateStatus;
}

function getUpdateStatus() {
  return { ...updateStatus };
}

function configureDevUpdaterIfRequested() {
  if (app.isPackaged) return true;
  if (process.env.DESKTOP_PET_FORCE_DEV_UPDATE !== "1") return false;
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.updateConfigPath = path.join(__dirname, "..", "dev-app-update.yml");
  return true;
}

function isUpdateAvailableInThisRuntime(manual) {
  if (configureDevUpdaterIfRequested()) return true;
  if (manual) {
    setUpdateStatus({
      status: "disabled",
      message: "开发模式不会检查自动更新，打包安装后可用",
      progress: 0
    });
  }
  return false;
}

function sendUpdateReadyPrompt(info) {
  if (updatePromptVisible || updateInstallStarted) return;
  updatePromptVisible = true;
  const ownerWindow = settingsWin && !settingsWin.isDestroyed()
    ? settingsWin
    : (win && !win.isDestroyed() ? win : null);
  const options = {
    type: "info",
    title: "更新已下载",
    message: `Our Pets ${info?.version || ""} 已下载完成`,
    detail: "重启应用后会安装新版本。",
    buttons: ["重启安装", "稍后"],
    defaultId: 0,
    cancelId: 1
  };
  const prompt = ownerWindow
    ? dialog.showMessageBox(ownerWindow, options)
    : dialog.showMessageBox(options);

  prompt.then((result) => {
    updatePromptVisible = false;
    if (result.response === 0) installDownloadedUpdate();
  }).catch((error) => {
    updatePromptVisible = false;
    console.warn(`Failed to show update prompt: ${error.message}`);
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({
      status: "checking",
      message: "正在检查更新...",
      progress: 0
    });
  });

  autoUpdater.on("update-available", (info) => {
    pendingUpdateInfo = normalizeUpdateInfo(info);
    updateCheckInProgress = false;
    updateDownloadInProgress = true;
    setUpdateStatus({
      status: "downloading",
      message: `发现新版本 ${pendingUpdateInfo.version || ""}，正在下载...`,
      progress: 0,
      updateInfo: pendingUpdateInfo
    });
  });

  autoUpdater.on("update-not-available", () => {
    updateCheckInProgress = false;
    updateDownloadInProgress = false;
    setUpdateStatus({
      status: "latest",
      message: "当前已是最新版本",
      progress: 0
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number(progress?.percent) || 0;
    setUpdateStatus({
      status: "downloading",
      message: `正在下载更新 ${Math.round(percent)}%`,
      progress: Math.max(0, Math.min(100, percent)),
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
      bytesPerSecond: progress?.bytesPerSecond || 0,
      updateInfo: pendingUpdateInfo
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    pendingUpdateInfo = normalizeUpdateInfo(info);
    updateCheckInProgress = false;
    updateDownloadInProgress = false;
    updateDownloaded = true;
    setUpdateStatus({
      status: "ready",
      message: `新版本 ${pendingUpdateInfo.version || ""} 已下载，重启后安装`,
      progress: 100,
      updateInfo: pendingUpdateInfo
    });
    sendUpdateReadyPrompt(pendingUpdateInfo);
  });

  autoUpdater.on("error", (error) => {
    updateCheckInProgress = false;
    updateDownloadInProgress = false;
    setUpdateStatus({
      status: "error",
      message: error?.message || "自动更新检查失败",
      progress: 0,
      updateInfo: pendingUpdateInfo
    });
  });
}

async function checkForUpdates(manual = false) {
  if (updateDownloaded) {
    return setUpdateStatus({
      status: "ready",
      message: `新版本 ${pendingUpdateInfo?.version || ""} 已下载，重启后安装`,
      progress: 100,
      updateInfo: pendingUpdateInfo
    });
  }

  if (updateCheckInProgress || updateDownloadInProgress) {
    return setUpdateStatus({
      status: updateDownloadInProgress ? "downloading" : "checking",
      message: updateDownloadInProgress ? "更新正在下载中..." : "正在检查更新...",
      updateInfo: pendingUpdateInfo
    });
  }

  if (!isUpdateAvailableInThisRuntime(manual)) return getUpdateStatus();

  updateCheckInProgress = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateCheckInProgress = false;
    return setUpdateStatus({
      status: "error",
      message: error?.message || "自动更新检查失败",
      progress: 0
    });
  }

  return getUpdateStatus();
}

function installDownloadedUpdate() {
  if (!updateDownloaded || updateInstallStarted) return getUpdateStatus();
  updateInstallStarted = true;
  setUpdateStatus({
    status: "installing",
    message: "正在重启并安装更新...",
    progress: 100,
    updateInfo: pendingUpdateInfo
  });
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return getUpdateStatus();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionBubble(size = {}) {
  if (!win || win.isDestroyed() || !bubbleWin || bubbleWin.isDestroyed()) return;

  const petBounds = win.getBounds();
  const display = screen.getDisplayMatching(petBounds);
  const area = display.workArea;
  const zoom = clampZoom(settings.zoom || 1);
  const spriteScale = 0.86 * zoom;
  const spriteWidth = 192 * spriteScale;
  const spriteHeight = 208 * spriteScale;
  const spriteLeft = 36 * zoom + 1 * zoom;
  const spriteBottom = 12 * zoom;
  const spriteTop = petBounds.y + petBounds.height - spriteBottom - spriteHeight;
  const spriteCenterX = petBounds.x + spriteLeft + spriteWidth / 2;
  const gap = 6;
  const margin = 8;
  const width = Math.ceil(Number(size.width) || 280);
  const height = Math.ceil(Number(size.height) || 96);
  const topY = spriteTop - height - gap;
  const bottomY = spriteTop + spriteHeight + gap;

  const x = clamp(
    Math.round(spriteCenterX - width / 2),
    area.x + margin,
    area.x + area.width - width - margin
  );
  const y = Math.round(topY >= area.y + margin
    ? topY
    : clamp(bottomY, area.y + margin, area.y + area.height - height - margin));

  bubbleWin.setBounds({ x, y, width, height });
}

function buildBubbleItems(state = currentState) {
  if (!state.message) return [];

  return [{
    message: String(state.message).slice(0, 500),
    durationMs: Number.isFinite(Number(state.bubbleDurationMs)) ? Number(state.bubbleDurationMs) : undefined
  }];
}

function showBubble(input) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  clearTimeout(bubbleTimer);
  bubbleTimer = null;

  const items = Array.isArray(input)
    ? input
    : (typeof input === "string" && input ? [{ message: input, persistent: false }] : []);

  if (items.length === 0) {
    bubbleWin.hide();
    return;
  }

  const payload = {
    message: items[0]?.message || "",
    items,
    bubbleScale: clampBubbleScale(settings.bubbleScale || 1)
  };

  positionBubble();
  bubbleWin.showInactive();

  if (bubbleReady) {
    bubbleWin.webContents.send("bubble:set-message", payload);
  } else {
    pendingBubblePayload = payload;
  }

  if (!items.some((item) => item.persistent)) {
    const durationMs = items.find((item) => Number.isFinite(item.durationMs))?.durationMs || 4200;
    bubbleTimer = setTimeout(() => {
      if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
    }, durationMs);
  }
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
    showBubble(buildBubbleItems(currentState));
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
  showBubble(buildBubbleItems(currentState));
}

function broadcastPet() {
  sendToWindows("pet:set-pet", toPetPayload(activePet));
}

function selectPet(idOrKey, source) {
  const nextPet = pets.find((pet) => {
    if (source && pet.source !== source) return false;
    return pet.id === idOrKey || pet.key === idOrKey;
  });

  if (!nextPet || nextPet.key === activePet?.key) return Boolean(nextPet);
  activePet = nextPet;
  settings.activePetKey = nextPet.key;
  saveSettings();
  broadcastPet();
  broadcastState({ state: "idle", message: "" });
  rebuildTrayMenu();
  return true;
}

function selectPetStorage(_storageId, customDir) {
  if (!customDir && !settings.customPetsDir) {
    return { ok: false, error: "请先选择自定义宠物文件夹", storage: getPetStorageInfo() };
  }
  if (customDir) settings.customPetsDir = path.resolve(String(customDir));
  settings.activePetKey = "";
  saveSettings();
  discoverPets();
  broadcastPet();
  return {
    ok: true,
    storage: getPetStorageInfo(),
    pets: pets.map(toPetPayload),
    activePet: toPetPayload(activePet)
  };
}

async function chooseCustomPetStorage() {
  const result = await dialog.showOpenDialog(settingsWin || win, {
    title: "选择宠物文件夹",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, canceled: true, storage: getPetStorageInfo() };
  }
  return selectPetStorage("custom", result.filePaths[0]);
}

async function openPetFolder(kind = "current") {
  const storage = getPetStorageInfo();
  const options = {
    current: storage.petsRoot || storage.customPetsRoot,
    custom: storage.customPetsRoot
  };
  const target = options[kind] || options.current;
  if (!target) return { ok: false, error: "目录尚未配置", storage };
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return { ok: !error, error, path: target, storage };
}

function buildInitialPayload() {
  const storage = getPetStorageInfo();
  return {
    ...currentState,
    normalizedState: normalizeState(currentState.state),
    pets: pets.map(toPetPayload),
    actions: ACTIONS,
    activePet: toPetPayload(activePet),
    config: {
      petsRoot: storage.petsRoot,
      customPetsRoot: storage.customPetsRoot,
      bundledPetsRoot: BUNDLED_PETS_ROOT,
      zoom: clampZoom(settings.zoom || 1),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      bubbleScale: clampBubbleScale(settings.bubbleScale || 1),
      minBubbleScale: MIN_BUBBLE_SCALE,
      maxBubbleScale: MAX_BUBBLE_SCALE,
      baseWindowWidth: BASE_WINDOW_WIDTH,
      baseWindowHeight: BASE_WINDOW_HEIGHT,
      appVersion: app.getVersion(),
      releaseUrl: RELEASES_URL,
      updateStatus: getUpdateStatus(),
      reminderStatus: reminderManager ? reminderManager.getStatus() : null,
      ...getLaunchSettingsPayload()
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

function buildTrayMenu() {
  const petItems = pets.map((pet) => ({
    label: pet.displayName,
    type: "radio",
    checked: pet.key === activePet?.key,
    click: () => selectPet(pet.key)
  }));

  return Menu.buildFromTemplate([
    {
      label: "显示 / 隐藏",
      click: () => {
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
      }
    },
    ...(petItems.length
      ? [{ label: "切换角色", submenu: petItems }, { type: "separator" }]
      : []),
    {
      label: "设置",
      click: () => createSettingsWindow()
    },
    {
      label: "说一句",
      click: () => {
        if (dailyGreetingManager) dailyGreetingManager.sayNow();
      }
    },
    {
      label: "开机自启动",
      type: "checkbox",
      checked: getAutoStartEnabled(),
      click: (menuItem) => {
        setAutoStart(menuItem.checked);
      }
    },
    {
      label: "免打扰模式",
      type: "checkbox",
      checked: reminderManager ? reminderManager.getConfig().quietMode : false,
      click: (menuItem) => {
        if (!reminderManager) return;
        reminderManager.updateConfig({ quietMode: menuItem.checked });
        saveSettings();
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit()
    }
  ]);
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = createAppIcon().resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Our Pets");
  tray.setContextMenu(buildTrayMenu());
}

function configureMacMenuBarMode() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("accessory");
  app.dock.hide();
}

app.whenReady().then(() => {
  app.setName("Our Pets");
  Menu.setApplicationMenu(null);
  configureMacMenuBarMode();
  if (process.platform === "win32") app.setAppUserModelId("com.robbenge.our-pets");
  loadSettings();
  applyStoredAutoStart();
  discoverPets();
  setupAutoUpdater();
  createWindow();
  createBubbleWindow();
  createTray();

  reminderManager = new ReminderManager({
    reminders: settings.reminders,
    save: (config) => {
      settings.reminders = config;
      saveSettings();
      rebuildTrayMenu();
    },
    onTrigger: ({ typeId, label, state, message, durationSeconds }) => {
      broadcastState({ state, message });
      if (durationSeconds > 0) {
        setTimeout(() => {
          broadcastState({ state: "idle", message: "" });
        }, durationSeconds * 1000);
      }
    }
  });
  reminderManager.start();

  dailyGreetingManager = new DailyGreetingManager({
    greeting: settings.dailyGreeting,
    save: (config) => {
      settings.dailyGreeting = config;
      saveSettings();
    },
    onGreet: showDailyGreeting
  });
  dailyGreetingManager.start();
  setTimeout(() => {
    dailyGreetingManager.tryStartupTasks();
  }, 1800);

  ipcMain.handle("pet:get-initial-state", () => buildInitialPayload());
  ipcMain.handle("pet:list-pets", () => {
    discoverPets();
    return {
      ok: true,
      pets: pets.map(toPetPayload),
      activePet: toPetPayload(activePet),
      actions: ACTIONS,
      storage: getPetStorageInfo()
    };
  });
  ipcMain.handle("pet:get-update-status", () => {
    return { ok: true, update: getUpdateStatus() };
  });
  ipcMain.handle("pet:check-for-updates", async () => {
    return { ok: true, update: await checkForUpdates(true) };
  });
  ipcMain.handle("pet:install-update", () => {
    return { ok: true, update: installDownloadedUpdate() };
  });
  ipcMain.handle("pet:open-releases", async () => {
    await shell.openExternal(RELEASES_URL);
    return { ok: true };
  });
  ipcMain.handle("pet:select-pet", (_event, payload) => {
    const ok = selectPet(String(payload?.id || payload?.key || ""), payload?.source);
    return { ok, activePet: toPetPayload(activePet), pets: pets.map(toPetPayload) };
  });
  ipcMain.handle("pet:select-storage", (_event, payload) => {
    try {
      return selectPetStorage(payload?.storage, payload?.customDir);
    } catch (error) {
      return { ok: false, error: error.message, storage: getPetStorageInfo(), pets: pets.map(toPetPayload), activePet: toPetPayload(activePet) };
    }
  });
  ipcMain.handle("pet:choose-custom-storage", async () => {
    try {
      return await chooseCustomPetStorage();
    } catch (error) {
      return { ok: false, error: error.message, storage: getPetStorageInfo(), pets: pets.map(toPetPayload), activePet: toPetPayload(activePet) };
    }
  });
  ipcMain.handle("pet:open-folder", async (_event, payload) => {
    try {
      return await openPetFolder(payload?.kind);
    } catch (error) {
      return { ok: false, error: error.message, storage: getPetStorageInfo() };
    }
  });
  ipcMain.handle("pet:set-state", (_event, payload) => {
    const state = String(payload?.state || "idle");
    if (!VALID_STATES.has(state)) return { ok: false, error: "Invalid state" };
    const durationMs = Number.isFinite(Number(payload?.durationMs)) ? Number(payload.durationMs) : 0;
    broadcastState({
      state,
      message: typeof payload?.message === "string" ? payload.message.slice(0, 120) : ""
    });
    if (durationMs > 0) {
      const returnState = typeof payload?.returnState === "string" && VALID_STATES.has(payload.returnState)
        ? payload.returnState
        : "idle";
      setTimeout(() => {
        if (currentState.state === state) {
          broadcastState({ state: returnState, message: "" });
        }
      }, Math.min(durationMs, 60_000));
    }
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

  ipcMain.handle("pet:get-reminders", () => {
    return { ok: true, reminders: reminderManager ? reminderManager.getStatus() : null };
  });
  ipcMain.handle("pet:update-reminder-config", (_event, payload) => {
    if (!reminderManager) return { ok: false, error: "Reminder engine not ready" };
    return reminderManager.updateConfig(payload);
  });
  ipcMain.handle("pet:trigger-reminder", (_event, payload) => {
    if (!reminderManager) return { ok: false, error: "Reminder engine not ready" };
    return reminderManager.triggerNow(payload?.typeId || payload?.id);
  });
  ipcMain.handle("pet:reset-reminders", (_event, payload) => {
    if (!reminderManager) return { ok: false, error: "Reminder engine not ready" };
    return reminderManager.reset(payload?.typeId || payload?.id);
  });
  ipcMain.handle("pet:get-launch-settings", () => {
    return { ok: true, ...getLaunchSettingsPayload() };
  });
  ipcMain.handle("pet:update-launch-settings", (_event, payload) => {
    if (typeof payload?.autoStart === "boolean") {
      setAutoStart(payload.autoStart);
    }
    if (payload?.dailyGreeting && dailyGreetingManager) {
      dailyGreetingManager.updateConfig(payload.dailyGreeting);
    }
    return { ok: true, ...getLaunchSettingsPayload() };
  });
  ipcMain.handle("pet:trigger-greeting-now", () => {
    if (!dailyGreetingManager) return { ok: false, error: "问候功能未就绪" };
    return dailyGreetingManager.sayNow();
  });

  setTimeout(() => {
    checkForUpdates(false).catch((error) => {
      console.warn(`Silent update check failed: ${error.message}`);
    });
  }, 5000);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  if (reminderManager) reminderManager.stop();
  if (dailyGreetingManager) dailyGreetingManager.stop();
});
