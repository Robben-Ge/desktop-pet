const apiInfo = document.getElementById("apiInfo");
const refreshBtn = document.getElementById("refreshBtn");
const storageTabs = document.getElementById("storageTabs");
const chooseCustomBtn = document.getElementById("chooseCustomBtn");
const petCount = document.getElementById("petCount");
const petList = document.getElementById("petList");
const actionGrid = document.getElementById("actionGrid");
const hookSummary = document.getElementById("hookSummary");
const hookList = document.getElementById("hookList");
const zoomInfo = document.getElementById("zoomInfo");
const bubbleInfo = document.getElementById("bubbleInfo");
const appVersion = document.getElementById("appVersion");
const updatePanel = document.getElementById("updatePanel");
const updateLamp = document.getElementById("updateLamp");
const updateState = document.getElementById("updateState");
const updateMessage = document.getElementById("updateMessage");
const updateProgressBar = document.getElementById("updateProgressBar");
const checkUpdateBtn = document.getElementById("checkUpdateBtn");
const installUpdateBtn = document.getElementById("installUpdateBtn");
const openReleasesBtn = document.getElementById("openReleasesBtn");
const storageName = document.getElementById("storageName");
const petsRoot = document.getElementById("petsRoot");
const codexPetsRoot = document.getElementById("codexPetsRoot");
const customPetsRoot = document.getElementById("customPetsRoot");
const settingsPath = document.getElementById("settingsPath");

let activePetKey = "";
let zoom = 1;
let bubbleScale = 1;
let installingHookAgent = "";
let activeHookAgent = "codex";
let currentStorage = "codex";
let currentCustomPetsRoot = "";
let currentUpdateStatus = "idle";

const UPDATE_STATUS_LABELS = {
  idle: "尚未检查",
  disabled: "开发模式",
  checking: "正在检查",
  downloading: "正在下载",
  ready: "等待安装",
  installing: "正在安装",
  latest: "已是最新",
  error: "检查失败"
};

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderActions(actions) {
  actionGrid.innerHTML = "";
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = "action-button";
    button.type = "button";
    button.innerHTML = `
      <span>
        <strong>${action.state}</strong>
        <span>${action.label}</span>
      </span>
      <span class="row-badge">row ${action.row}</span>
    `;
    button.addEventListener("click", () => {
      window.desktopPet.setState({
        state: action.state,
        message: action.label
      });
    });
    actionGrid.appendChild(button);
  }
}

function renderHookStatus(hooks) {
  const list = Array.isArray(hooks) ? hooks : [];
  const okCount = list.filter((hook) => hook.state === "ok").length;
  const selected = list.find((hook) => hook.selected);
  hookSummary.textContent = `${okCount}/${list.length} 已接入 · 监听 ${selected?.label || activeHookAgent}`;
  hookList.innerHTML = "";

  for (const hook of list) {
    const item = document.createElement("article");
    item.className = `hook-item ${hook.state || "missing"}`;

    const lamp = document.createElement("span");
    lamp.className = "hook-lamp";
    lamp.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "hook-body";
    body.appendChild(createTextElement("div", "hook-name", hook.label || hook.agent));

    const reason = hook.reason || (hook.state === "ok" ? "已接入" : "未接入");
    body.appendChild(createTextElement("div", "hook-reason", reason));
    body.appendChild(createTextElement(
      "div",
      "hook-meta",
      `${hook.configuredCount || 0}/${hook.totalEvents || 0} events · ${hook.settingsPath || ""}`
    ));

    if (Array.isArray(hook.missing) && hook.missing.length > 0) {
      body.appendChild(createTextElement("div", "hook-missing", `缺失：${hook.missing.join(", ")}`));
    }

    if (hook.lastEvent?.receivedAt) {
      const receivedAt = new Date(hook.lastEvent.receivedAt);
      const timeText = Number.isNaN(receivedAt.getTime()) ? hook.lastEvent.receivedAt : receivedAt.toLocaleTimeString();
      body.appendChild(createTextElement("div", "hook-meta", `最后命中：${timeText} · ${hook.lastEvent.event || ""}`));
    }

    const actions = document.createElement("div");
    actions.className = "hook-actions";
    actions.appendChild(createTextElement("span", "hook-badge", hook.state === "ok" ? "OK" : (hook.state === "error" ? "ERROR" : "未接入")));

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = hook.selected ? "hook-listen active" : "hook-listen";
    selectButton.textContent = hook.selected ? "监听中" : "监听";
    selectButton.disabled = hook.selected;
    selectButton.addEventListener("click", () => selectHookAgent(hook));
    actions.appendChild(selectButton);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "hook-fix";
    if (hook.state === "ok") {
      button.textContent = "已接入";
      button.disabled = true;
    } else if (hook.state === "error") {
      button.textContent = "需手动处理";
      button.disabled = true;
    } else {
      button.textContent = installingHookAgent === hook.agent ? "修复中..." : "修复";
      button.disabled = installingHookAgent === hook.agent;
      button.addEventListener("click", () => installHook(hook));
    }
    actions.appendChild(button);

    item.appendChild(lamp);
    item.appendChild(body);
    item.appendChild(actions);
    hookList.appendChild(item);
  }
}

function renderUpdateStatus(update) {
  const payload = update || {};
  const status = payload.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
  currentUpdateStatus = status;

  appVersion.textContent = `v${payload.version || ""}`;
  updatePanel.dataset.status = status;
  updateLamp.className = `update-lamp is-${status}`;
  updateState.textContent = UPDATE_STATUS_LABELS[status] || status;
  updateMessage.textContent = payload.message || "等待检查更新";
  updateProgressBar.style.width = `${progress}%`;

  const busy = status === "checking" || status === "downloading" || status === "installing";
  checkUpdateBtn.disabled = busy;
  checkUpdateBtn.textContent = busy ? "处理中..." : "检查更新";
  installUpdateBtn.hidden = status !== "ready";
}

async function selectHookAgent(hook) {
  if (!hook.agent) return;
  try {
    const result = await window.desktopPet.selectHookAgent({ agent: hook.agent });
    if (!result.ok) {
      window.alert(result.error || "切换监听失败");
      return;
    }
    activeHookAgent = result.activeHookAgent || hook.agent;
    renderHookStatus(result.hooks || []);
  } catch (error) {
    window.alert(error.message || "切换监听失败");
  }
}

async function installHook(hook) {
  const agent = hook.agent;
  if (!agent) return;

  const confirmed = window.confirm(`要为 ${hook.label || agent} 写入真实 hook 配置吗？\n\n配置文件：${hook.settingsPath}`);
  if (!confirmed) return;

  installingHookAgent = agent;
  const current = await window.desktopPet.getHookStatus();
  renderHookStatus(current.hooks || []);

  try {
    const result = await window.desktopPet.installHooks({ agent });
    if (!result.ok) {
      window.alert(result.error || "hook 修复失败");
    }
    installingHookAgent = "";
    renderHookStatus(result.hooks || []);
  } catch (error) {
    window.alert(error.message || "hook 修复失败");
  } finally {
    installingHookAgent = "";
    const next = await window.desktopPet.getHookStatus();
    renderHookStatus(next.hooks || []);
  }
}

function renderPets(pets) {
  const list = Array.isArray(pets) ? pets : [];
  petCount.textContent = String(list.length);
  petList.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "当前目录还没有可用宠物。请从上方渠道下载宠物包，解压后放入当前目录，或切换到自定义宠物文件夹。";
    petList.appendChild(empty);
    return;
  }

  for (const pet of list) {
    const sourceLabel = pet.sourceLabel || (pet.source === "builtin" ? "内置" : "目录");
    const item = document.createElement("article");
    item.className = `pet-item${pet.key === activePetKey ? " active" : ""}`;
    item.innerHTML = `
      <div>
        <div class="pet-title">
          <div class="pet-name">${pet.displayName || pet.id}</div>
          <span class="pet-source">${sourceLabel}</span>
        </div>
        <div class="pet-meta">${pet.key}</div>
      </div>
      <button type="button" class="${pet.key === activePetKey ? "primary" : ""}">
        ${pet.key === activePetKey ? "当前" : "使用"}
      </button>
    `;
    item.querySelector("button").addEventListener("click", async () => {
      const result = await window.desktopPet.selectPet({ key: pet.key });
      if (result.ok) {
        activePetKey = result.activePet?.key || "";
        renderPets(result.pets);
      }
    });
    petList.appendChild(item);
  }
}

function renderStorage(storage) {
  if (!storage) return;
  currentStorage = storage.petStorage || "codex";
  currentCustomPetsRoot = storage.customPetsRoot || "";
  storageName.textContent = currentStorage === "custom" ? "自定义文件夹" : ".codex 宠物";
  petsRoot.textContent = storage.petsRoot || "";
  codexPetsRoot.textContent = storage.codexPetsRoot || "";
  customPetsRoot.textContent = storage.customPetsRoot || "未设置";

  storageTabs.querySelectorAll("[data-storage]").forEach((button) => {
    const active = button.dataset.storage === currentStorage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

async function applyPetResult(result) {
  if (result.storage) renderStorage(result.storage);
  if (result.activePet) activePetKey = result.activePet.key || "";
  if (Array.isArray(result.pets)) renderPets(result.pets);
}

async function loadSettings() {
  const initial = await window.desktopPet.getInitialState();
  activePetKey = initial.activePet?.key || "";
  zoom = Number(initial.config?.zoom) || 1;
  bubbleScale = Number(initial.config?.bubbleScale) || 1;
  activeHookAgent = initial.config?.activeHookAgent || "codex";
  renderUpdateStatus(initial.config?.updateStatus || { version: initial.config?.appVersion });
  zoomInfo.textContent = `${Math.round(zoom * 100)}%`;
  bubbleInfo.textContent = `${Math.round(bubbleScale * 100)}%`;
  apiInfo.textContent = initial.config?.apiBaseUrl || "";
  settingsPath.textContent = initial.config?.settingsPath || "";
  renderStorage({
    petStorage: initial.config?.petStorage,
    petsRoot: initial.config?.petsRoot,
    codexPetsRoot: initial.config?.codexPetsRoot,
    customPetsRoot: initial.config?.customPetsRoot
  });
  renderPets(initial.pets || []);
  renderActions(initial.actions || []);
  renderHookStatus(initial.config?.hookStatus || []);
  window.desktopPet.getHookStatus().then((result) => renderHookStatus(result.hooks || []));
  window.desktopPet.getUpdateStatus().then((result) => renderUpdateStatus(result.update));
}

window.desktopPet.onPetChange((pet) => {
  activePetKey = pet?.key || "";
  window.desktopPet.listPets().then((result) => applyPetResult(result));
});
window.desktopPet.onStateChange(() => {});
window.desktopPet.onZoomChange((payload) => {
  zoom = Number(payload?.zoom) || zoom;
  zoomInfo.textContent = `${Math.round(zoom * 100)}%`;
});
window.desktopPet.onBubbleScaleChange((payload) => {
  bubbleScale = Number(payload?.bubbleScale) || bubbleScale;
  bubbleInfo.textContent = `${Math.round(bubbleScale * 100)}%`;
});
window.desktopPet.onUpdateStatus((payload) => renderUpdateStatus(payload));

refreshBtn.addEventListener("click", loadSettings);

checkUpdateBtn.addEventListener("click", async () => {
  renderUpdateStatus({
    status: "checking",
    message: "正在检查更新...",
    version: appVersion.textContent.replace(/^v/, "")
  });
  const result = await window.desktopPet.checkForUpdates();
  if (result.update) renderUpdateStatus(result.update);
});

installUpdateBtn.addEventListener("click", async () => {
  if (currentUpdateStatus !== "ready") return;
  const result = await window.desktopPet.installUpdate();
  if (result.update) renderUpdateStatus(result.update);
});

openReleasesBtn.addEventListener("click", () => {
  window.desktopPet.openReleases();
});

storageTabs.querySelectorAll("[data-storage]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (button.dataset.storage === "custom" && !currentCustomPetsRoot) {
      const chosen = await window.desktopPet.chooseCustomPetStorage();
      if (chosen.ok) applyPetResult(chosen);
      return;
    }

    const result = await window.desktopPet.selectPetStorage({ storage: button.dataset.storage });
    if (!result.ok) {
      window.alert(result.error || "切换宠物目录失败");
      return;
    }
    applyPetResult(result);
  });
});

chooseCustomBtn.addEventListener("click", async () => {
  const result = await window.desktopPet.chooseCustomPetStorage();
  if (result.ok) applyPetResult(result);
});

document.querySelectorAll("[data-open-folder]").forEach((button) => {
  button.addEventListener("click", async () => {
    const result = await window.desktopPet.openPetFolder({ kind: button.dataset.openFolder });
    if (!result.ok) window.alert(result.error || "打开文件夹失败");
  });
});

document.querySelectorAll("[data-zoom]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextZoom = Number(button.dataset.zoom);
    if (!Number.isFinite(nextZoom)) return;
    window.desktopPet.resizeWindow({ zoom: nextZoom });
  });
});

document.querySelectorAll("[data-bubble-scale]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextScale = Number(button.dataset.bubbleScale);
    if (!Number.isFinite(nextScale)) return;
    window.desktopPet.resizeBubble({ bubbleScale: nextScale });
  });
});

loadSettings();
