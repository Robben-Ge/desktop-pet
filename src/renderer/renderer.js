const pet = document.getElementById("pet");
const stage = document.querySelector(".stage");
const sprite = document.getElementById("sprite");
const fallback = document.getElementById("fallback");
const resizeHandle = document.getElementById("resizeHandle");
const fallbackArtwork = [
  fallback.querySelector(".bot-head"),
  fallback.querySelector(".bot-body")
].filter(Boolean);

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 11;
const BASE_SPRITE_SCALE = 0.86;
const BASE_WINDOW_WIDTH = 240;
const BASE_WINDOW_HEIGHT = 286;
const HIT_ALPHA_THRESHOLD = 24;
const HIT_PADDING = 4;
let minZoom = 0.65;
let maxZoom = 2.4;

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
let spriteHitMask = null;
let spriteHitMaskLoadToken = 0;
let spriteHitMaskStatus = "empty";
let lastPointerPosition = null;
let mouseEventsIgnored = null;
let interactionActive = false;

function normalizeState(state) {
  const requested = state || "idle";
  return STATE_ALIASES[requested] || requested;
}

function clampZoom(value) {
  return Math.max(minZoom, Math.min(maxZoom, value));
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function setMousePassthrough(ignore) {
  const nextIgnore = Boolean(ignore);
  if (mouseEventsIgnored === nextIgnore) return;
  mouseEventsIgnored = nextIgnore;
  window.desktopPet.setIgnoreMouseEvents(nextIgnore);
}

function numericStyleValue(style, property) {
  const value = Number.parseFloat(style[property]);
  return Number.isFinite(value) ? value : 0;
}

function mapClientPointToSprite(clientX, clientY) {
  const petStyle = getComputedStyle(pet);
  const petWidth = numericStyleValue(petStyle, "width");
  const petHeight = numericStyleValue(petStyle, "height");
  const petLeft = numericStyleValue(petStyle, "left");
  const petTop = innerHeight - numericStyleValue(petStyle, "bottom") - petHeight;
  const transformOrigin = petStyle.transformOrigin
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  const originX = Number.isFinite(transformOrigin[0]) ? transformOrigin[0] : petWidth / 2;
  const originY = Number.isFinite(transformOrigin[1]) ? transformOrigin[1] : petHeight / 2;

  try {
    const transform = petStyle.transform === "none"
      ? new DOMMatrixReadOnly()
      : new DOMMatrixReadOnly(petStyle.transform);
    const inverse = transform.inverse();
    const point = new DOMPoint(
      clientX - petLeft - originX,
      clientY - petTop - originY
    ).matrixTransform(inverse);
    const untransformedX = petLeft + originX + point.x;
    const untransformedY = petTop + originY + point.y;
    if (!Number.isFinite(untransformedX) || !Number.isFinite(untransformedY)) return null;

    const spriteStyle = getComputedStyle(sprite);
    const width = numericStyleValue(spriteStyle, "width");
    const height = numericStyleValue(spriteStyle, "height");
    const left = petLeft + numericStyleValue(spriteStyle, "left");
    const top = petTop + petHeight - numericStyleValue(spriteStyle, "bottom") - height;
    return {
      x: untransformedX - left,
      y: untransformedY - top,
      width,
      height
    };
  } catch {
    return null;
  }
}

function isSpriteCellPointInteractive(cellX, cellY) {
  if (spriteHitMaskStatus !== "ready" || !spriteHitMask) return false;
  const rowDef = ROWS[currentState] || ROWS.idle;
  const localX = Math.floor(cellX);
  const localY = Math.floor(cellY);
  const frame = frameIndex % ATLAS_COLS;
  const minX = Math.max(0, localX - HIT_PADDING);
  const maxX = Math.min(CELL_WIDTH - 1, localX + HIT_PADDING);
  const minY = Math.max(0, localY - HIT_PADDING);
  const maxY = Math.min(CELL_HEIGHT - 1, localY + HIT_PADDING);

  for (let y = minY; y <= maxY; y += 1) {
    const sourceY = rowDef.row * CELL_HEIGHT + y;
    if (sourceY < 0 || sourceY >= spriteHitMask.height) continue;
    for (let x = minX; x <= maxX; x += 1) {
      const sourceX = frame * CELL_WIDTH + x;
      if (sourceX < 0 || sourceX >= spriteHitMask.width) continue;
      if (spriteHitMask.alpha[sourceY * spriteHitMask.width + sourceX] >= HIT_ALPHA_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
}

function isSpritePointInteractive(clientX, clientY) {
  if (!sprite.classList.contains("ready")) return false;
  const point = mapClientPointToSprite(clientX, clientY);
  if (!point || point.width <= 0 || point.height <= 0 ||
      point.x < 0 || point.x >= point.width || point.y < 0 || point.y >= point.height) {
    return false;
  }

  // Keep the pet grabbable for the brief interval while a valid local
  // spritesheet is decoded. A failed decode switches to the fallback pet.
  if (spriteHitMaskStatus === "loading") return true;
  if (spriteHitMaskStatus !== "ready") return false;

  return isSpriteCellPointInteractive(
    point.x * CELL_WIDTH / point.width,
    point.y * CELL_HEIGHT / point.height
  );
}

function isFallbackPointInteractive(clientX, clientY) {
  if (!fallback.classList.contains("show")) return false;
  const target = document.elementFromPoint(clientX, clientY);
  return Boolean(target) && fallbackArtwork.some((element) => (
    target === element || element.contains(target)
  ));
}

function isInteractivePoint(clientX, clientY) {
  if (interactionActive) return true;

  const handleStyle = getComputedStyle(resizeHandle);
  if (handleStyle.pointerEvents !== "none" && Number(handleStyle.opacity) > 0.05 &&
      pointInRect(clientX, clientY, resizeHandle.getBoundingClientRect())) {
    return true;
  }

  if (isFallbackPointInteractive(clientX, clientY)) return true;

  return isSpritePointInteractive(clientX, clientY);
}

function refreshMousePassthrough() {
  const point = lastPointerPosition;
  const interactive = interactionActive ||
    (point?.inside !== false && Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
      isInteractivePoint(point.x, point.y));
  setMousePassthrough(!interactive);
}

function rememberPointerPosition(point) {
  const x = Number(point?.clientX ?? point?.x);
  const y = Number(point?.clientY ?? point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  lastPointerPosition = { x, y, inside: point?.inside !== false };
  refreshMousePassthrough();
}

function setInteractionActive(active, point) {
  interactionActive = Boolean(active);
  if (point) {
    const x = Number(point.clientX);
    const y = Number(point.clientY);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      lastPointerPosition = { x, y, inside: true };
    }
  }
  refreshMousePassthrough();
}

function releaseInteractionCapture(element, pointerId) {
  if (typeof element.hasPointerCapture === "function" && element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
}

function failSpriteHitMask(loadToken, error) {
  if (loadToken !== spriteHitMaskLoadToken) return;
  spriteHitMask = null;
  spriteHitMaskStatus = "failed";
  sprite.classList.remove("ready");
  fallback.classList.add("show");
  if (error) console.warn(`Unable to build sprite hit mask: ${error.message}`);
  refreshMousePassthrough();
}

function loadSpriteHitMask(url) {
  const loadToken = ++spriteHitMaskLoadToken;
  spriteHitMask = null;
  spriteHitMaskStatus = url ? "loading" : "empty";
  refreshMousePassthrough();
  if (!url) return;

  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    if (loadToken !== spriteHitMaskLoadToken) return;
    try {
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error("spritesheet has no image data");
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas 2D context is unavailable");
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let source = 3, target = 0; target < alpha.length; source += 4, target += 1) {
        alpha[target] = rgba[source];
      }
      if (loadToken !== spriteHitMaskLoadToken) return;
      spriteHitMask = { width: canvas.width, height: canvas.height, alpha };
      spriteHitMaskStatus = "ready";
      sprite.classList.add("ready");
      fallback.classList.remove("show");
    } catch (error) {
      failSpriteHitMask(loadToken, error);
      return;
    }
    refreshMousePassthrough();
  }, { once: true });
  image.addEventListener("error", () => {
    failSpriteHitMask(loadToken, new Error("spritesheet could not be loaded"));
  }, { once: true });
  image.src = url;
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

function updateSpriteMetrics() {
  const atlasScale = getAtlasScale();
  sprite.style.width = `${CELL_WIDTH * atlasScale}px`;
  sprite.style.height = `${CELL_HEIGHT * atlasScale}px`;
  sprite.style.backgroundSize =
    `${CELL_WIDTH * ATLAS_COLS * atlasScale}px ${CELL_HEIGHT * ATLAS_ROWS * atlasScale}px`;
}

function drawFrame() {
  const rowDef = ROWS[currentState] || ROWS.idle;
  const atlasScale = getAtlasScale();
  const x = -(frameIndex * CELL_WIDTH * atlasScale);
  const y = -(rowDef.row * CELL_HEIGHT * atlasScale);

  sprite.style.backgroundPosition = `${x}px ${y}px`;
  refreshMousePassthrough();
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
  loadSpriteHitMask(currentPet?.spritesheetUrl || null);

  if (!currentPet?.spritesheetUrl) {
    sprite.classList.remove("ready");
    fallback.classList.add("show");
    refreshMousePassthrough();
    return;
  }

  sprite.style.backgroundImage = `url("${currentPet.spritesheetUrl}")`;
  updateSpriteMetrics();
  sprite.classList.add("ready");
  fallback.classList.remove("show");
  setAnimationState("idle");
  refreshMousePassthrough();
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
  if (dragStart || resizeStart) return;

  const pendingDrag = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    lastScreenX: event.screenX,
    windowX: null,
    windowY: null,
    boundsReady: false
  };
  dragStart = pendingDrag;
  clickCandidate = {
    screenX: event.screenX,
    screenY: event.screenY,
    startedAt: Date.now()
  };
  lastDragDirection = null;
  pet.setPointerCapture(event.pointerId);
  setInteractionActive(true, event);

  let bounds = null;
  try {
    bounds = await window.desktopPet.getWindowBounds();
  } catch {
    // Treat a failed IPC request like a missing window so the input lock cannot stick.
  }

  if (dragStart !== pendingDrag) return;
  if (!bounds) {
    dragStart = null;
    clickCandidate = null;
    lastDragDirection = null;
    releaseInteractionCapture(pet, event.pointerId);
    setInteractionActive(false);
    return;
  }

  pendingDrag.windowX = bounds.x;
  pendingDrag.windowY = bounds.y;
  pendingDrag.boundsReady = true;
}

function moveDrag(event) {
  if (!dragStart || !dragStart.boundsReady || event.pointerId !== dragStart.pointerId) return;
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
  const isClick = event.type === "pointerup" && movedX <= 4 && movedY <= 4 && elapsed <= 500;
  dragStart = null;
  lastDragDirection = null;
  clickCandidate = null;
  setInteractionActive(false, event);

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
  requestAnimationFrame(refreshMousePassthrough);
}

function hideResizeHandleSoon() {
  clearTimeout(hideResizeTimer);
  hideResizeTimer = setTimeout(() => {
    if (!resizeStart) stage.classList.remove("show-resize");
    refreshMousePassthrough();
  }, 180);
}

async function startResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (dragStart || resizeStart) return;

  const pendingResize = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    width: null,
    height: null,
    zoom,
    boundsReady: false
  };
  resizeStart = pendingResize;
  showResizeHandle();
  resizeHandle.setPointerCapture(event.pointerId);
  setInteractionActive(true, event);

  let bounds = null;
  try {
    bounds = await window.desktopPet.getWindowBounds();
  } catch {
    // Treat a failed IPC request like a missing window so the input lock cannot stick.
  }

  if (resizeStart !== pendingResize) return;
  if (!bounds) {
    resizeStart = null;
    releaseInteractionCapture(resizeHandle, event.pointerId);
    setInteractionActive(false);
    hideResizeHandleSoon();
    return;
  }

  pendingResize.width = bounds.width;
  pendingResize.height = bounds.height;
  pendingResize.boundsReady = true;
}

function moveResize(event) {
  if (!resizeStart || !resizeStart.boundsReady || event.pointerId !== resizeStart.pointerId) return;
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
  setInteractionActive(false, event);
  hideResizeHandleSoon();
}

document.addEventListener("mousemove", rememberPointerPosition, true);
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
document.addEventListener("pointerup", endResize);
document.addEventListener("pointercancel", endResize);
document.addEventListener("mouseleave", () => {
  if (interactionActive) return;
  lastPointerPosition = null;
  setMousePassthrough(true);
}, true);

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
window.desktopPet.onCursorPosition(rememberPointerPosition);
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
setMousePassthrough(true);
