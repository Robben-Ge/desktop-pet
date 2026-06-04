const apiInfo = document.getElementById("apiInfo");
const refreshBtn = document.getElementById("refreshBtn");
const petCount = document.getElementById("petCount");
const petList = document.getElementById("petList");
const actionGrid = document.getElementById("actionGrid");
const hookSummary = document.getElementById("hookSummary");
const hookList = document.getElementById("hookList");
const zoomInfo = document.getElementById("zoomInfo");
const bubbleInfo = document.getElementById("bubbleInfo");
const petsRoot = document.getElementById("petsRoot");
const petRunsRoot = document.getElementById("petRunsRoot");
const settingsPath = document.getElementById("settingsPath");

let activePetKey = "";
let zoom = 1;
let bubbleScale = 1;
let installingHookAgent = "";

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
  hookSummary.textContent = `${okCount}/${list.length} 已接入`;
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

    const meta = createTextElement(
      "div",
      "hook-meta",
      `${hook.configuredCount || 0}/${hook.totalEvents || 0} events · ${hook.settingsPath || ""}`
    );
    body.appendChild(meta);

    if (Array.isArray(hook.missing) && hook.missing.length > 0) {
      body.appendChild(createTextElement("div", "hook-missing", `缺失：${hook.missing.join(", ")}`));
    }

    const actions = document.createElement("div");
    actions.className = "hook-actions";
    actions.appendChild(createTextElement("span", "hook-badge", hook.state === "ok" ? "OK" : (hook.state === "error" ? "ERROR" : "未接入")));

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
  petCount.textContent = String(pets.length);
  petList.innerHTML = "";

  for (const pet of pets) {
    const item = document.createElement("article");
    item.className = `pet-item${pet.key === activePetKey ? " active" : ""}`;
    item.innerHTML = `
      <div>
        <div class="pet-name">${pet.displayName || pet.id}</div>
        <div class="pet-meta">${pet.key}</div>
        <div class="pet-meta">${pet.spritesheetPath}</div>
      </div>
      <button type="button" class="${pet.key === activePetKey ? "primary" : ""}">
        ${pet.key === activePetKey ? "当前" : "使用"}
      </button>
    `;
    item.querySelector("button").addEventListener("click", async () => {
      const result = await window.desktopPet.selectPet({ key: pet.key });
      if (result.ok) {
        activePetKey = result.activePet.key;
        renderPets(result.pets);
      }
    });
    petList.appendChild(item);
  }
}

async function loadSettings() {
  const initial = await window.desktopPet.getInitialState();
  activePetKey = initial.activePet?.key || "";
  zoom = Number(initial.config?.zoom) || 1;
  bubbleScale = Number(initial.config?.bubbleScale) || 1;
  zoomInfo.textContent = `${Math.round(zoom * 100)}%`;
  bubbleInfo.textContent = `${Math.round(bubbleScale * 100)}%`;
  apiInfo.textContent = initial.config?.apiBaseUrl || "";
  petsRoot.textContent = initial.config?.petsRoot || "";
  petRunsRoot.textContent = initial.config?.petRunsRoot || "";
  settingsPath.textContent = initial.config?.settingsPath || "";
  renderPets(initial.pets || []);
  renderActions(initial.actions || []);
  renderHookStatus(initial.config?.hookStatus || []);
  window.desktopPet.getHookStatus().then((result) => renderHookStatus(result.hooks || []));
}

window.desktopPet.onPetChange((pet) => {
  activePetKey = pet?.key || "";
  window.desktopPet.listPets().then((result) => renderPets(result.pets || []));
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
refreshBtn.addEventListener("click", loadSettings);
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
