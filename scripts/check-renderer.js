const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain } = require("electron");

// Exercise the actual renderer and preload without starting main.js or touching
// the installed app's settings. Linux needs a display (or xvfb-run).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "our-pets-renderer-"));
app.setPath("userData", userData);

function removeUserData() {
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    // The detached cleaner retries after Chromium exits.
  }
}

process.once("exit", removeUserData);
const root = path.join(__dirname, "..");

function scheduleUserDataCleanup() {
  const cleaner = spawn(
    process.execPath,
    [
      "-e",
      `
        const fs = require("node:fs");
        const [directory, parentPid] = process.argv.slice(1);
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        (async () => {
          while (true) {
            try {
              process.kill(Number(parentPid), 0);
              await sleep(25);
            } catch {
              break;
            }
          }
          for (let attempt = 0; attempt < 40 && fs.existsSync(directory); attempt += 1) {
            try {
              fs.rmSync(directory, { recursive: true, force: true });
            } catch {}
            await sleep(100);
          }
        })();
      `,
      userData,
      String(process.pid)
    ],
    {
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
      windowsHide: true
    }
  );
  cleaner.unref();
}

scheduleUserDataCleanup();
const activePet = {
  key: "renderer-test",
  spritesheetUrl: pathToFileURL(path.join(root, "src/assets/pets/robben/spritesheet.webp")).href
};
const brokenHitTestPet = {
  key: "broken-hit-test",
  spritesheetUrl: pathToFileURL(path.join(userData, "missing-spritesheet.webp")).href
};
const bundledHitTestPets = fs.readdirSync(path.join(root, "src/assets/pets"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    key: `hit-test-${entry.name}`,
    spritesheetUrl: pathToFileURL(
      path.join(root, "src/assets/pets", entry.name, "spritesheet.webp")
    ).href
  }));
const calls = [];
let window;
let bounds = { x: 100, y: 100, width: 156, height: 186 };

ipcMain.handle("pet:get-initial-state", () => ({
  config: { zoom: 0.65, minZoom: 0.65, maxZoom: 2.4 },
  activePet,
  state: "idle"
}));
ipcMain.handle("pet:get-window-bounds", () => bounds);
for (const channel of ["pet:set-state", "pet:move-window", "pet:resize-window", "pet:finish-drag"]) {
  ipcMain.handle(channel, (_event, payload) => {
    calls.push({ channel, payload });
    return true;
  });
}
ipcMain.on("pet:drag-direction", (_event, payload) => calls.push({ channel: "pet:drag-direction", payload }));
ipcMain.on("pet:set-ignore-mouse-events", (_event, payload) => {
  calls.push({ channel: "pet:set-ignore-mouse-events", payload: Boolean(payload) });
});

const evaluate = (source) => window.webContents.executeJavaScript(source);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function mouse(type, x, y) {
  window.webContents.sendInputEvent({
    type, x, y, globalX: bounds.x + x, globalY: bounds.y + y,
    ...(type === "mouseMove" ? {} : { button: "left", clickCount: 1 })
  });
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await delay(20);
  }
}
function near(actual, expected, description) {
  assert.ok(Math.abs(actual - expected) < 0.08, `${description}: expected ${expected}, got ${actual}`);
}
async function setZoom(zoom) {
  bounds = { ...bounds, width: Math.round(240 * zoom), height: Math.round(286 * zoom) };
  window.setBounds(bounds);
  window.webContents.send("pet:set-zoom", { zoom });
  await waitFor(() => evaluate(`Number(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) === ${zoom} && innerWidth === ${bounds.width} && innerHeight === ${bounds.height}`), `zoom ${zoom}`);
}
async function geometry() {
  return evaluate(`(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      pet: rect("#pet"), fallback: rect("#fallback"),
      handle: rect("#resizeHandle"), icon: rect(".resize-icon"),
      spriteOpacity: getComputedStyle(document.querySelector("#sprite")).opacity,
      fallbackOpacity: getComputedStyle(document.querySelector("#fallback")).opacity
    };
  })()`);
}
async function hitTargets() {
  return evaluate(`(() => {
    const pet = document.querySelector("#pet");
    const rect = pet.getBoundingClientRect();
    const hit = (x, y) => {
      const element = document.elementFromPoint(x, y);
      return { id: element?.id || element?.className || null, pet: !!element && pet.contains(element) };
    };
    return {
      above: hit(rect.left + 50, rect.top - 8),
      right: hit(rect.right + 4, rect.top + 15),
      inside: hit(rect.left + rect.width / 2, rect.top + rect.height / 2)
    };
  })()`);
}

async function spriteHitMaskPoints() {
  return evaluate(`(() => {
    const rect = document.querySelector("#sprite").getBoundingClientRect();
    let opaque = null;
    let transparent = null;
    for (let y = Math.ceil(rect.top); y < Math.floor(rect.bottom); y += 1) {
      for (let x = Math.ceil(rect.left); x < Math.floor(rect.right); x += 1) {
        const interactive = isSpritePointInteractive(x, y);
        if (interactive && !opaque) opaque = { x, y };
        if (!interactive && !transparent) transparent = { x, y };
        if (opaque && transparent) return { opaque, transparent };
      }
    }
    return { opaque, transparent };
  })()`);
}

async function rotatedSpriteHitMaskResult() {
  return evaluate(`(() => {
    const petElement = document.querySelector("#pet");
    const spriteElement = document.querySelector("#sprite");
    const previousTransform = petElement.style.transform;
    try {
      petElement.style.transform = "rotate(4deg)";
      const petStyle = getComputedStyle(petElement);
      const spriteStyle = getComputedStyle(spriteElement);
      const petWidth = Number.parseFloat(petStyle.width);
      const petHeight = Number.parseFloat(petStyle.height);
      const petLeft = Number.parseFloat(petStyle.left);
      const petTop = innerHeight - Number.parseFloat(petStyle.bottom) - petHeight;
      const origin = petStyle.transformOrigin.split(/\\s+/).map(Number.parseFloat);
      const originX = petLeft + origin[0];
      const originY = petTop + origin[1];
      const transform = new DOMMatrixReadOnly(petStyle.transform);
      const spriteWidth = Number.parseFloat(spriteStyle.width);
      const spriteHeight = Number.parseFloat(spriteStyle.height);
      const spriteLeft = petLeft + Number.parseFloat(spriteStyle.left);
      const spriteTop = petTop + petHeight - Number.parseFloat(spriteStyle.bottom) - spriteHeight;
      const transformedRect = spriteElement.getBoundingClientRect();
      let checkedOpaque = 0;
      let checkedTransparent = 0;
      let mismatches = 0;
      let oldMappingMismatches = 0;

      for (let cellY = 0; cellY < CELL_HEIGHT; cellY += 4) {
        for (let cellX = 0; cellX < CELL_WIDTH; cellX += 4) {
          const expected = isSpriteCellPointInteractive(cellX + 0.5, cellY + 0.5);
          const untransformedX = spriteLeft + (cellX + 0.5) * spriteWidth / CELL_WIDTH;
          const untransformedY = spriteTop + (cellY + 0.5) * spriteHeight / CELL_HEIGHT;
          const transformed = new DOMPoint(
            untransformedX - originX,
            untransformedY - originY
          ).matrixTransform(transform);
          const clientX = originX + transformed.x;
          const clientY = originY + transformed.y;
          const actual = isSpritePointInteractive(clientX, clientY);
          if (expected) checkedOpaque += 1;
          else checkedTransparent += 1;
          if (actual !== expected) mismatches += 1;

          const oldInside = clientX >= transformedRect.left && clientX < transformedRect.right &&
            clientY >= transformedRect.top && clientY < transformedRect.bottom;
          const oldCellX = Math.floor(
            (clientX - transformedRect.left) * CELL_WIDTH / transformedRect.width
          );
          const oldCellY = Math.floor(
            (clientY - transformedRect.top) * CELL_HEIGHT / transformedRect.height
          );
          const oldResult = oldInside && isSpriteCellPointInteractive(oldCellX, oldCellY);
          if (oldResult !== expected) oldMappingMismatches += 1;
        }
      }
      return { checkedOpaque, checkedTransparent, mismatches, oldMappingMismatches };
    } finally {
      petElement.style.transform = previousTransform;
    }
  })()`);
}

async function stationaryTransformHitPoint() {
  return evaluate(`(() => {
    const petElement = document.querySelector("#pet");
    const spriteElement = document.querySelector("#sprite");
    const previousTransform = petElement.style.transform;
    try {
      petElement.style.transform = "translateY(0px)";
      const petStyle = getComputedStyle(petElement);
      const spriteStyle = getComputedStyle(spriteElement);
      const petHeight = Number.parseFloat(petStyle.height);
      const petLeft = Number.parseFloat(petStyle.left);
      const petTop = innerHeight - Number.parseFloat(petStyle.bottom) - petHeight;
      const spriteWidth = Number.parseFloat(spriteStyle.width);
      const spriteHeight = Number.parseFloat(spriteStyle.height);
      const spriteLeft = petLeft + Number.parseFloat(spriteStyle.left);
      const spriteTop = petTop + petHeight - Number.parseFloat(spriteStyle.bottom) - spriteHeight;
      let candidates = [];

      for (let cellY = CELL_HEIGHT - 1; cellY >= 0 && candidates.length === 0; cellY -= 1) {
        for (let cellX = 0; cellX < CELL_WIDTH; cellX += 1) {
          if (!isSpriteCellPointInteractive(cellX + 0.5, cellY + 0.5)) continue;
          candidates.push({
            x: spriteLeft + (cellX + 0.5) * spriteWidth / CELL_WIDTH,
            y: spriteTop + (cellY + 0.5) * spriteHeight / CELL_HEIGHT
          });
        }
      }

      petElement.style.transform = "translateY(-14px)";
      const point = candidates.find(({ x, y }) => !isSpritePointInteractive(x, y)) || null;
      if (!point) return null;
      const movedInteractive = isSpritePointInteractive(point.x, point.y);
      petElement.style.transform = "translateY(0px)";
      const restingInteractive = isSpritePointInteractive(point.x, point.y);
      return { point, restingInteractive, movedInteractive };
    } finally {
      petElement.style.transform = previousTransform;
    }
  })()`);
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    show: true,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(root, "src/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  await window.loadFile(path.join(root, "src/renderer/index.html"));
  await waitFor(() => evaluate('document.querySelector("#sprite").classList.contains("ready")'), "renderer initialization");
  // sendInputEvent targets this BrowserWindow directly, so the test does not
  // depend on an X11 window manager being available in CI.
  window.focus();
  // Optional baseline stylesheet makes it possible to prove this test detects
  // the original bug without replacing files in the working tree.
  if (process.env.RENDERER_TEST_CSS) {
    const stylesheet = fs.readFileSync(process.env.RENDERER_TEST_CSS, "utf8");
    await evaluate(`(() => {
      const link = document.querySelector('link[rel="stylesheet"]');
      const style = document.createElement("style");
      style.textContent = ${JSON.stringify(stylesheet)};
      link.replaceWith(style);
    })`);
  }
  // Pause only motion; scaling and hit testing still use production CSS.
  await window.webContents.insertCSS("* { animation: none !important; transition: none !important; }");

  await waitFor(() => evaluate("Boolean(spriteHitMask?.alpha?.length)"), "sprite alpha hit mask");
  await evaluate("clearTimeout(frameTimer); scheduleNextFrame = () => {}; frameIndex = 0; drawFrame();");
  const maskPoints = await spriteHitMaskPoints();
  assert.ok(maskPoints.opaque, "sprite mask must contain an interactive pixel");
  assert.ok(maskPoints.transparent, "sprite mask must retain transparent pixels inside its frame");
  window.webContents.send("pet:cursor-position", { ...maskPoints.opaque, inside: true });
  await waitFor(
    () => calls.filter((call) => call.channel === "pet:set-ignore-mouse-events").at(-1)?.payload === false,
    "opaque sprite pixel enables mouse input"
  );
  window.webContents.send("pet:cursor-position", { ...maskPoints.transparent, inside: true });
  await waitFor(
    () => calls.filter((call) => call.channel === "pet:set-ignore-mouse-events").at(-1)?.payload === true,
    "transparent sprite pixel enables click-through"
  );
  console.log("PASS: sprite alpha mask toggles native window mouse passthrough");

  for (const testPet of bundledHitTestPets) {
    window.webContents.send("pet:set-pet", testPet);
    await waitFor(
      () => evaluate(`currentPet?.key === ${JSON.stringify(testPet.key)} && Boolean(spriteHitMask?.alpha?.length)`),
      `alpha hit mask for ${testPet.key}`
    );
    const points = await spriteHitMaskPoints();
    assert.ok(points.opaque, `${testPet.key} must contain an interactive pixel`);
    assert.ok(points.transparent, `${testPet.key} must preserve transparent pixels`);
  }
  window.webContents.send("pet:set-pet", activePet);
  await waitFor(
    () => evaluate(`currentPet?.key === ${JSON.stringify(activePet.key)} && Boolean(spriteHitMask?.alpha?.length)`),
    "restore renderer test pet"
  );
  console.log("PASS: every bundled pet builds an alpha hit mask");

  let hits = await hitTargets();
  assert.equal(hits.above.pet, false, `transparent fallback extends hit area above the scaled pet (${hits.above.id})`);
  assert.equal(hits.right.pet, false, `transparent fallback extends hit area to the right of the scaled pet (${hits.right.id})`);
  assert.equal(hits.inside.id, "pet", "decorative sprites should let the pet receive pointer events");
  console.log("PASS: shrinking to 0.65 removes the old transparent hit area");

  for (const zoom of [0.65, 1, 2.4]) {
    await setZoom(zoom);
    await evaluate('document.querySelector(".stage").classList.add("show-resize")');
    const rects = await geometry();
    near(rects.pet.width, 168 * zoom, `pet width at ${zoom}`);
    near(rects.pet.height, 184 * zoom, `pet height at ${zoom}`);
    near(rects.handle.width, 26 * zoom, `handle width at ${zoom}`);
    near(rects.handle.height, 26 * zoom, `handle height at ${zoom}`);
    near(rects.icon.width, 18 * zoom, `icon width at ${zoom}`);
    near(rects.icon.height, 18 * zoom, `icon height at ${zoom}`);
    near(bounds.width - rects.handle.right, 34 * zoom, `handle right offset at ${zoom}`);
    near(bounds.height - rects.handle.bottom, 52 * zoom, `handle bottom offset at ${zoom}`);
    assert.equal((await hitTargets()).inside.id, "pet", `sprite must not intercept input at ${zoom}`);
    const points = await spriteHitMaskPoints();
    assert.ok(points.opaque, `sprite must stay interactive at ${zoom}`);
    assert.ok(points.transparent, `transparent sprite pixels must pass through at ${zoom}`);
  }
  console.log("PASS: pet, resize handle, icon, and offsets scale at 0.65, 1, and 2.4");
  const rotatedMask = await rotatedSpriteHitMaskResult();
  assert.ok(rotatedMask.checkedOpaque > 0, "rotated mask test must exercise opaque pixels");
  assert.ok(rotatedMask.checkedTransparent > 0, "rotated mask test must exercise transparent pixels");
  assert.equal(rotatedMask.mismatches, 0, "rotated sprite pixels must map back to the correct alpha cells");
  assert.ok(
    rotatedMask.oldMappingMismatches > 0,
    "rotated mask regression must distinguish inverse mapping from an axis-aligned bounding box"
  );
  console.log("PASS: rotated animation frames preserve pixel-accurate hit testing");

  const stationaryTransform = await stationaryTransformHitPoint();
  assert.ok(stationaryTransform, "animation test must find a pixel crossed by the moving pet");
  assert.equal(stationaryTransform.restingInteractive, true);
  assert.equal(stationaryTransform.movedInteractive, false);
  await evaluate('document.querySelector("#pet").style.transform = "translateY(0px)"; mouseEventsIgnored = null;');
  const restingProbeCalls = calls.length;
  window.webContents.send("pet:cursor-position", { ...stationaryTransform.point, inside: true });
  await waitFor(
    () => calls.slice(restingProbeCalls).some(
      (call) => call.channel === "pet:set-ignore-mouse-events" && call.payload === false
    ),
    "stationary cursor enables input over the resting pet"
  );
  await evaluate('document.querySelector("#pet").style.transform = "translateY(-14px)"');
  const movedProbeCalls = calls.length;
  window.webContents.send("pet:cursor-position", { ...stationaryTransform.point, inside: true });
  await waitFor(
    () => calls.slice(movedProbeCalls).some(
      (call) => call.channel === "pet:set-ignore-mouse-events" && call.payload === true
    ),
    "stationary cursor passes through after the pet moves away"
  );
  await evaluate('document.querySelector("#pet").style.transform = ""');
  console.log("PASS: stationary cursor probes track CSS transform animation");

  window.webContents.send("pet:set-state", { state: "running" });
  await waitFor(() => evaluate('document.querySelector("#pet").dataset.state === "running"'), "non-idle state");
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#resizeHandle")).pointerEvents'), "none", "hidden handle must not intercept input");
  window.webContents.send("pet:set-state", { state: "idle" });
  await waitFor(() => evaluate('document.querySelector("#pet").dataset.state === "idle"'), "idle state");

  window.webContents.send("pet:set-pet", brokenHitTestPet);
  await waitFor(
    () => evaluate(
      'currentPet?.key === "broken-hit-test" && spriteHitMaskStatus === "failed" && document.querySelector("#fallback").classList.contains("show")'
    ),
    "broken spritesheet fallback"
  );
  assert.equal(await evaluate('document.querySelector("#sprite").classList.contains("ready")'), false);
  console.log("PASS: a broken spritesheet falls back without a rectangular sprite hit area");

  window.webContents.send("pet:set-pet", { key: "missing-spritesheet" });
  await waitFor(() => evaluate('document.querySelector("#fallback").classList.contains("show")'), "fallback rendering");
  for (const zoom of [0.65, 1, 2.4]) {
    await setZoom(zoom);
    const rects = await geometry();
    assert.equal(rects.fallbackOpacity, "1", `fallback visible at ${zoom}`);
    assert.equal(rects.spriteOpacity, "0", `sprite hidden at ${zoom}`);
    near(rects.fallback.width, 126 * zoom, `fallback width at ${zoom}`);
    near(rects.fallback.height, 164 * zoom, `fallback height at ${zoom}`);
    near(rects.fallback.left - rects.pet.left, 20 * zoom, `fallback left offset at ${zoom}`);
    near(rects.pet.bottom - rects.fallback.bottom, 2 * zoom, `fallback bottom offset at ${zoom}`);
    hits = await hitTargets();
    assert.equal(hits.above.pet, false, `fallback must fit inside pet at ${zoom}`);
    assert.equal(hits.right.pet, false, `fallback must fit inside pet at ${zoom}`);
    assert.equal(hits.inside.id, "pet", `fallback and hidden sprite must not intercept input at ${zoom}`);
  }
  console.log("PASS: missing-spritesheet fallback stays visible, scaled, and inside the pet");

  await setZoom(0.65);
  const rects = await geometry();
  const x = Math.round(rects.pet.left + rects.pet.width / 2);
  const y = Math.round(rects.pet.top + rects.pet.height / 2);
  mouse("mouseMove", 2, 2);
  await evaluate('document.querySelector(".stage").classList.remove("show-resize")');
  mouse("mouseMove", x, y);
  await waitFor(() => evaluate('document.querySelector(".stage").classList.contains("show-resize")'), "hover shows resize handle");
  mouse("mouseDown", x, y);
  await waitFor(() => evaluate("dragStart !== null"), "pet drag start");
  mouse("mouseUp", x, y);
  await waitFor(() => calls.some((call) => call.channel === "pet:set-state"), "pet click action");
  assert.equal(calls.find((call) => call.channel === "pet:set-state").payload.state, "jumping");

  mouse("mouseDown", x, y);
  await waitFor(() => evaluate("dragStart !== null"), "second pet drag start");
  mouse("mouseMove", x + 12, y + 8);
  await waitFor(() => calls.some((call) => call.channel === "pet:move-window" && call.payload.x === 112 && call.payload.y === 108), "pet drag movement");
  mouse("mouseUp", x + 12, y + 8);
  await waitFor(() => calls.some((call) => call.channel === "pet:finish-drag"), "pet drag end");
  assert.deepEqual(calls.filter((call) => call.channel === "pet:move-window").at(-1).payload, { x: 112, y: 108 });

  await evaluate('document.querySelector(".stage").classList.add("show-resize")');
  const handle = (await geometry()).handle;
  const handleX = Math.round(handle.left + handle.width / 2);
  const handleY = Math.round(handle.top + handle.height / 2);
  mouse("mouseMove", handleX, handleY);
  mouse("mouseDown", handleX, handleY);
  await waitFor(() => evaluate("resizeStart !== null"), "resize start");
  mouse("mouseMove", handleX + 4, handleY + 4);
  await waitFor(() => calls.some((call) => call.channel === "pet:resize-window"), "resize movement");
  mouse("mouseUp", handleX + 4, handleY + 4);
  assert.equal(calls.find((call) => call.channel === "pet:resize-window").payload.zoom, 2 / 3, "resize gesture zoom");
  await waitFor(() => evaluate("resizeStart === null"), "resize end");
  console.log("PASS: real mouse input still clicks, drags, and resizes through the preload IPC bridge");
}

async function main() {
  let exitCode = 0;
  try {
    await run();
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    // Best-effort cleanup; the detached cleaner retries after Chromium exits.
    await delay(250);
    removeUserData();
  }
  process.exitCode = exitCode;
  app.quit();
}

main();
