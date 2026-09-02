const pet = document.getElementById("pet");
const stage = document.querySelector(".stage");
const sprite = document.getElementById("sprite");
const fallback = document.getElementById("fallback");
const resizeHandle = document.getElementById("resizeHandle");

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ATLAS_COLS = 8;
const DEFAULT_ATLAS_ROWS = 11; // Codex Pet V2
const BASE_SPRITE_SCALE = 0.86;
const BASE_WINDOW_WIDTH = 240;
const BASE_WINDOW_HEIGHT = 286;
let minZoom = 0.65;
let maxZoom = 2.4;
let atlasRows = DEFAULT_ATLAS_ROWS;

const ROWS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] }
};

const STATE_ALIASES = {
  start: "waving",
  success: "jumping",
  done: "jumping",
  sleeping: "failed",
  working: "running",
  thinking: "review"
};

let currentPet = null;
let currentState = "idle";
let frameIndex = 0;
let frameTimer = null;
let dragStart = null;
let lastDragDirection = null;
let zoom = 1;
let resizeStart = null;
let hideResizeTimer = null;
let bubbleScale = 1;
let clickCandidate = null;

function normalizeState(state) {
  const requested = state || "idle";
  return STATE_ALIASES[requested] || requested;
}

function clampZoom(value) {
  return Math.max(minZoom, Math.min(maxZoom, value));
}

function applyZoom(nextZoom) {
  zoom = clampZoom(nextZoom || 1);
  document.documentElement.style.setProperty("--zoom", String(zoom));
  document.documentElement.style.setProperty("--pet-left", `${36 * zoom}px`);
  document.documentElement.style.setProperty("--pet-bottom", `${12 * zoom}px`);
  document.documentElement.style.setProperty("--pet-width", `${168 * zoom}px`);
  document.documentElement.style.setProperty("--pet-height", `${184 * zoom}px`);
  document.documentElement.style.setProperty("--sprite-left", `${1 * zoom}px`);
  document.documentElement.style.setProperty("--handle-right", `${34 * zoom}px`);
  document.documentElement.style.setProperty("--handle-bottom", `${52 * zoom}px`);
  updateSpriteMetrics();
  drawFrame();
}

function applyBubbleScale(nextScale) {
  bubbleScale = Number.isFinite(Number(nextScale)) ? Number(nextScale) : 1;
  bubbleScale = Math.max(0.75, Math.min(1.6, bubbleScale));
}

function getAtlasScale() {
  return BASE_SPRITE_SCALE * zoom;
}

function resolveAtlasRows(petPayload) {
  const rows = Number(petPayload?.atlasRows);
  if (rows === 9 || rows === 11) return rows;
  const version = Number(petPayload?.spriteVersionNumber);
  return version === 1 ? 9 : DEFAULT_ATLAS_ROWS;
}

function updateSpriteMetrics() {
  const atlasScale = getAtlasScale();
  sprite.style.width = `${CELL_WIDTH * atlasScale}px`;
  sprite.style.height = `${CELL_HEIGHT * atlasScale}px`;
  sprite.style.backgroundSize =
    `${CELL_WIDTH * ATLAS_COLS * atlasScale}px ${CELL_HEIGHT * atlasRows * atlasScale}px`;
}

function drawFrame() {
  const rowDef = ROWS[currentState] || ROWS.idle;
  const atlasScale = getAtlasScale();
  const x = -(frameIndex * CELL_WIDTH * atlasScale);
  const y = -(rowDef.row * CELL_HEIGHT * atlasScale);

  sprite.style.backgroundPosition = `${x}px ${y}px`;
}

function scheduleNextFrame() {
  clearTimeout(frameTimer);

  const rowDef = ROWS[currentState] || ROWS.idle;
  const duration = rowDef.durations[frameIndex] || 160;

  frameTimer = setTimeout(() => {
    frameIndex = (frameIndex + 1) % rowDef.durations.length;
    drawFrame();
    scheduleNextFrame();
  }, duration);
}

function setAnimationState(state) {
  const normalized = normalizeState(state);
  currentState = ROWS[normalized] ? normalized : "idle";
  frameIndex = 0;
  pet.dataset.state = currentState;
  if (currentState !== "idle" && !resizeStart) {
    stage.classList.remove("show-resize");
  }
  drawFrame();
  scheduleNextFrame();
}

function setPet(petPayload) {
  currentPet = petPayload || null;
  atlasRows = resolveAtlasRows(currentPet);

  if (!currentPet?.spritesheetUrl) {
    sprite.classList.remove("ready");
    fallback.classList.add("show");
    return;
  }

  sprite.style.backgroundImage = `url("${currentPet.spritesheetUrl}")`;
  updateSpriteMetrics();
  sprite.classList.add("ready");
  fallback.classList.remove("show");
  setAnimationState("idle");
}

function setPetState(payload) {
  if (payload?.activePet && payload.activePet?.key !== currentPet?.key) {
    setPet(payload.activePet);
  }

  setAnimationState(payload?.normalizedState || payload?.state || "idle");
}

async function startDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest("#resizeHandle")) return;
  const bounds = await window.desktopPet.getWindowBounds();
  if (!bounds) return;

  dragStart = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    lastScreenX: event.screenX,
    windowX: bounds.x,
    windowY: bounds.y
  };
  clickCandidate = {
    screenX: event.screenX,
    screenY: event.screenY,
    startedAt: Date.now()
  };
  lastDragDirection = null;
  pet.setPointerCapture(event.pointerId);
}

function moveDrag(event) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  const dx = event.screenX - dragStart.startScreenX;
  const dy = event.screenY - dragStart.startScreenY;
  const stepX = event.screenX - dragStart.lastScreenX;
  dragStart.lastScreenX = event.screenX;

  window.desktopPet.moveWindow({
    x: dragStart.windowX + dx,
    y: dragStart.windowY + dy
  });

  if (Math.abs(stepX) < 1) return;
  const direction = stepX > 0 ? "running-right" : "running-left";
  if (direction !== lastDragDirection) {
    lastDragDirection = direction;
    window.desktopPet.setDragDirection(direction);
  }
}

function endDrag(event) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  const movedX = Math.abs(event.screenX - dragStart.startScreenX);
  const movedY = Math.abs(event.screenY - dragStart.startScreenY);
  const elapsed = clickCandidate ? Date.now() - clickCandidate.startedAt : Infinity;
  const isClick = movedX <= 4 && movedY <= 4 && elapsed <= 500;
  dragStart = null;
  lastDragDirection = null;
  clickCandidate = null;

  if (isClick) {
    window.desktopPet.setState({
      state: "jumping",
      message: "",
      durationMs: 900,
      returnState: currentState
    });
    return;
  }

  window.desktopPet.finishDrag();
}

function showResizeHandle() {
  if (currentState !== "idle" && !resizeStart) return;
  clearTimeout(hideResizeTimer);
  stage.classList.add("show-resize");
}

function hideResizeHandleSoon() {
  clearTimeout(hideResizeTimer);
  hideResizeTimer = setTimeout(() => {
    if (!resizeStart) stage.classList.remove("show-resize");
  }, 180);
}

async function startResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const bounds = await window.desktopPet.getWindowBounds();
  if (!bounds) return;

  resizeStart = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    width: bounds.width,
    height: bounds.height,
    zoom
  };
  showResizeHandle();
  resizeHandle.setPointerCapture(event.pointerId);
}

function moveResize(event) {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) return;
  event.preventDefault();
  event.stopPropagation();

  const dx = event.screenX - resizeStart.startScreenX;
  const dy = event.screenY - resizeStart.startScreenY;
  const nextWidthZoom = (resizeStart.width + dx) / BASE_WINDOW_WIDTH;
  const nextHeightZoom = (resizeStart.height + dy) / BASE_WINDOW_HEIGHT;
  const nextZoom = clampZoom(Math.max(nextWidthZoom, nextHeightZoom));

  applyZoom(nextZoom);
  window.desktopPet.resizeWindow({ zoom: nextZoom });
}

function endResize(event) {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  resizeStart = null;
  hideResizeHandleSoon();
}

window.desktopPet.getInitialState().then((initial) => {
  const config = initial?.config || {};
  minZoom = Number(config.minZoom) || minZoom;
  maxZoom = Number(config.maxZoom) || maxZoom;
  applyZoom(Number(config.zoom) || 1);
  applyBubbleScale(Number(config.bubbleScale) || 1);
  setPet(initial?.activePet);
  setPetState(initial);
});
window.desktopPet.onPetChange(setPet);
window.desktopPet.onStateChange(setPetState);
window.desktopPet.onZoomChange((payload) => applyZoom(Number(payload?.zoom) || zoom));
window.desktopPet.onBubbleScaleChange((payload) => applyBubbleScale(Number(payload?.bubbleScale) || bubbleScale));
pet.addEventListener("pointerdown", startDrag);
pet.addEventListener("pointermove", moveDrag);
pet.addEventListener("pointerup", endDrag);
pet.addEventListener("pointercancel", endDrag);
pet.addEventListener("dblclick", () => window.desktopPet.openSettings());
pet.addEventListener("pointerenter", showResizeHandle);
pet.addEventListener("pointerleave", hideResizeHandleSoon);
resizeHandle.addEventListener("pointerenter", showResizeHandle);
resizeHandle.addEventListener("pointerleave", hideResizeHandleSoon);
resizeHandle.addEventListener("pointerdown", startResize);
resizeHandle.addEventListener("pointermove", moveResize);
resizeHandle.addEventListener("pointerup", endResize);
resizeHandle.addEventListener("pointercancel", endResize);
