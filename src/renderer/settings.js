const apiInfo = document.getElementById("apiInfo");
const refreshBtn = document.getElementById("refreshBtn");
const chooseCustomBtn = document.getElementById("chooseCustomBtn");
const petCount = document.getElementById("petCount");
const petCountLabel = document.getElementById("petCountLabel");
const petList = document.getElementById("petList");
const petSourceTabs = document.getElementById("petSourceTabs");
const reloadPetsBtn = document.getElementById("reloadPetsBtn");
const actionGrid = document.getElementById("actionGrid");
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
const customPetsRoot = document.getElementById("customPetsRoot");

let activePetKey = "";
let zoom = 1;
let bubbleScale = 1;
let currentCustomPetsRoot = "";
let currentUpdateStatus = "idle";
let allPets = [];
let activePetSource = "builtin";

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

function renderActions(actions) {
  if (!actionGrid) return;
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

function getPetSourceLabel(source) {
  return source === "builtin" ? "内置" : "自定义";
}

function getVisiblePets() {
  return allPets.filter((pet) => (pet.source || "pets") === activePetSource);
}

function renderPetSourceTabs() {
  const counts = allPets.reduce((result, pet) => {
    const source = pet.source || "pets";
    result[source] = (result[source] || 0) + 1;
    return result;
  }, { builtin: 0, pets: 0 });

  petSourceTabs.querySelectorAll("[data-pet-source]").forEach((button) => {
    const source = button.dataset.petSource;
    const active = source === activePetSource;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.textContent = `${getPetSourceLabel(source)} ${counts[source] || 0}`;
  });
}

function renderPets(pets) {
  allPets = Array.isArray(pets) ? pets : [];
  const list = getVisiblePets();
  renderPetSourceTabs();
  petCount.textContent = String(list.length);
  petCountLabel.textContent = `${getPetSourceLabel(activePetSource)}宠物`;
  petList.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = activePetSource === "pets"
      ? "自定义目录还没有宠物。请选择文件夹，放入 pet.json 和 spritesheet.webp，再点重新加载。"
      : "暂未找到内置宠物。";
    petList.appendChild(empty);
    return;
  }

  for (const pet of list) {
    const sourceLabel = pet.sourceLabel || getPetSourceLabel(pet.source);
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
        activePetSource = result.activePet?.source || activePetSource;
        renderPets(result.pets);
      }
    });
    petList.appendChild(item);
  }
}

function renderStorage(storage) {
  if (!storage) return;
  currentCustomPetsRoot = storage.customPetsRoot || "";
  if (customPetsRoot) {
    customPetsRoot.textContent = storage.customPetsRoot || "未设置";
  }
}

async function applyPetResult(result, options = {}) {
  if (result.storage) renderStorage(result.storage);
  if (result.activePet) {
    activePetKey = result.activePet.key || "";
    activePetSource = options.petSource || result.activePet.source || activePetSource;
  } else if (options.petSource) {
    activePetSource = options.petSource;
  }
  if (Array.isArray(result.pets)) renderPets(result.pets);
}

async function loadSettings() {
  const initial = await window.desktopPet.getInitialState();
  activePetKey = initial.activePet?.key || "";
  activePetSource = initial.activePet?.source || "builtin";
  zoom = Number(initial.config?.zoom) || 1;
  bubbleScale = Number(initial.config?.bubbleScale) || 1;
  renderUpdateStatus(initial.config?.updateStatus || { version: initial.config?.appVersion });
  zoomInfo.textContent = `${Math.round(zoom * 100)}%`;
  bubbleInfo.textContent = `${Math.round(bubbleScale * 100)}%`;
  renderStorage({
    customPetsRoot: initial.config?.customPetsRoot
  });
  renderPets(initial.pets || []);
  renderActions(initial.actions || []);
  renderReminders(initial.config?.reminderStatus);
  renderLaunchSettings({
    autoStart: initial.config?.autoStart,
    dailyGreeting: initial.config?.dailyGreeting
  });
  window.desktopPet.getUpdateStatus().then((result) => renderUpdateStatus(result.update));
  window.desktopPet.getReminders().then((result) => { if (result.ok) renderReminders(result.reminders); });
  window.desktopPet.getLaunchSettings().then((result) => {
    if (result.ok) renderLaunchSettings(result);
  });
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

petSourceTabs.querySelectorAll("[data-pet-source]").forEach((button) => {
  button.addEventListener("click", () => {
    activePetSource = button.dataset.petSource || "pets";
    renderPets(allPets);
  });
});

reloadPetsBtn.addEventListener("click", async () => {
  reloadPetsBtn.disabled = true;
  reloadPetsBtn.textContent = "加载中...";
  try {
    const result = await window.desktopPet.listPets();
    applyPetResult(result, { petSource: "pets" });
  } catch (error) {
    window.alert(error.message || "重新加载目录失败");
  } finally {
    reloadPetsBtn.disabled = false;
    reloadPetsBtn.textContent = "重新加载目录";
  }
});

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

// ---- Reminder Settings ----

const reminderIcons = {
  "drink-water": "💧",
  "stretch": "🏃",
  "rest-eyes": "👁",
  "take-break": "☕",
  "clock-out": "🎉"
};

const reminderMasterToggle = document.getElementById("reminderMasterToggle");
const reminderQuietToggle = document.getElementById("reminderQuietToggle");
const reminderWorkStart = document.getElementById("reminderWorkStart");
const reminderWorkEnd = document.getElementById("reminderWorkEnd");
const reminderTypeList = document.getElementById("reminderTypeList");
const reminderSummary = document.getElementById("reminderSummary");

let currentReminderConfig = null;

function renderReminders(reminders) {
  if (!reminders) return;
  currentReminderConfig = reminders;

  reminderMasterToggle.checked = reminders.enabled;
  reminderQuietToggle.checked = reminders.quietMode;
  reminderWorkStart.value = reminders.workHours?.start || "09:00";
  reminderWorkEnd.value = reminders.workHours?.end || "18:00";

  const enabledCount = (reminders.types || []).filter((t) => t.enabled).length;
  reminderSummary.textContent = reminders.enabled
    ? `已启用 · ${enabledCount}/${reminders.types.length} 项`
    : "已停用";

  renderReminderTypes(reminders.types || []);
}

const REMINDER_ANIMATIONS = [
  { value: "waving", label: "挥手" },
  { value: "jumping", label: "跳跃" },
  { value: "running", label: "工作" },
  { value: "waiting", label: "等待" },
  { value: "review", label: "思考" },
  { value: "failed", label: "趴下" },
  { value: "idle", label: "待机" }
];

function renderReminderTypes(types) {
  reminderTypeList.innerHTML = "";

  for (const type of types) {
    const card = document.createElement("div");
    card.className = `reminder-type-card${type.enabled ? "" : " disabled"}`;

    // ---- Row 1: name + mode info ----
    const row1 = document.createElement("div");
    row1.className = "reminder-top-row";

    const iconSpan = document.createElement("span");
    iconSpan.className = "reminder-icon";
    iconSpan.textContent = reminderIcons[type.id] || "🔔";

    const infoDiv = document.createElement("div");
    infoDiv.className = "reminder-info";
    infoDiv.innerHTML = `
      <div class="reminder-name">${type.label}</div>
      <div class="reminder-meta">${type.mode === "scheduled" ? `定点 ${type.scheduledTime}` : `间隔 ${type.intervalMinutes} 分钟`}</div>
    `;

    row1.appendChild(iconSpan);
    row1.appendChild(infoDiv);

    // Delete button for custom types
    const isBuiltin = ["drink-water", "stretch", "rest-eyes", "take-break", "clock-out"].includes(type.id);
    if (!isBuiltin) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "reminder-delete";
      delBtn.textContent = "×";
      delBtn.title = "删除此提醒";
      delBtn.addEventListener("click", () => deleteReminderType(type.id));
      row1.appendChild(delBtn);
    }

    card.appendChild(row1);

    // ---- Row 2: controls (toggle, interval, animation, duration, elapsed) ----
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "reminder-controls";

    // Enable toggle
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = type.enabled;
    toggle.addEventListener("change", () => {
      saveReminderType(type.id, { enabled: toggle.checked });
    });
    controlsDiv.appendChild(toggle);

    // Mode toggle
    const modeToggle = document.createElement("button");
    modeToggle.type = "button";
    modeToggle.className = "reminder-mode-toggle";
    modeToggle.textContent = type.mode === "scheduled" ? "定点" : "间隔";
    modeToggle.addEventListener("click", () => {
      const newMode = type.mode === "scheduled" ? "interval" : "scheduled";
      const patch = { mode: newMode };
      if (newMode === "interval" && !type.intervalMinutes) patch.intervalMinutes = 60;
      if (newMode === "scheduled" && !type.scheduledTime) patch.scheduledTime = "18:00";
      saveReminderType(type.id, patch);
    });
    controlsDiv.appendChild(modeToggle);

    // Interval number or time picker
    if (type.mode === "interval") {
      const numInput = document.createElement("input");
      numInput.type = "number";
      numInput.min = 1;
      numInput.max = 999;
      numInput.step = 1;
      numInput.value = type.intervalMinutes || 60;
      numInput.style.width = "48px";
      numInput.title = "分钟";
      numInput.addEventListener("change", () => {
        const val = Math.max(1, Math.min(999, parseInt(numInput.value, 10) || 1));
        numInput.value = val;
        saveReminderType(type.id, { intervalMinutes: val });
      });
      controlsDiv.appendChild(numInput);

      const unit = document.createElement("span");
      unit.textContent = "分";
      unit.className = "reminder-unit";
      controlsDiv.appendChild(unit);
    } else {
      const timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = type.scheduledTime || "18:00";
      timeInput.style.width = "68px";
      timeInput.addEventListener("change", () => {
        saveReminderType(type.id, { scheduledTime: timeInput.value });
      });
      controlsDiv.appendChild(timeInput);
    }

    // Animation picker
    const animSpan = document.createElement("span");
    animSpan.textContent = "动画";
    animSpan.className = "reminder-unit";
    controlsDiv.appendChild(animSpan);

    const animSelect = document.createElement("select");
    animSelect.style.width = "64px";
    for (const a of REMINDER_ANIMATIONS) {
      const opt = document.createElement("option");
      opt.value = a.value;
      opt.textContent = a.label;
      if (a.value === (type.animationState || "waving")) opt.selected = true;
      animSelect.appendChild(opt);
    }
    animSelect.addEventListener("change", () => {
      saveReminderType(type.id, { animationState: animSelect.value });
    });
    controlsDiv.appendChild(animSelect);

    // Duration
    const durInput = document.createElement("input");
    durInput.type = "number";
    durInput.min = 1;
    durInput.max = 60;
    durInput.step = 1;
    durInput.value = type.durationSeconds || 5;
    durInput.style.width = "46px";
    durInput.title = "动画持续秒数";
    durInput.addEventListener("change", () => {
      const val = Math.max(1, Math.min(60, parseInt(durInput.value, 10) || 5));
      durInput.value = val;
      saveReminderType(type.id, { durationSeconds: val });
    });
    controlsDiv.appendChild(durInput);

    const durUnit = document.createElement("span");
    durUnit.textContent = "秒";
    durUnit.className = "reminder-unit";
    controlsDiv.appendChild(durUnit);

    // Elapsed
    const elapsed = document.createElement("span");
    elapsed.className = "reminder-elapsed";
    elapsed.title = "距离上次提醒已过去的时间";
    if (type.mode === "interval" && type.elapsedSeconds !== undefined) {
      const m = Math.floor(type.elapsedSeconds / 60);
      const s = type.elapsedSeconds % 60;
      elapsed.textContent = m > 0 ? `${m}m${s}s` : `${s}s`;
    }
    controlsDiv.appendChild(elapsed);

    card.appendChild(controlsDiv);

    // ---- Row 3: message input ----
    const msgRow = document.createElement("div");
    msgRow.className = "reminder-msg-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "reminder-msg-input";
    input.value = type.message || "";
    input.placeholder = "点击输入自定义提醒文字...";
    input.addEventListener("blur", () => {
      saveReminderMessage(type.id, input.value);
    });
    msgRow.appendChild(input);

    const hint = document.createElement("span");
    hint.className = "reminder-msg-hint";
    hint.textContent = "{minutes} = 间隔分钟数";
    msgRow.appendChild(hint);

    card.appendChild(msgRow);
    reminderTypeList.appendChild(card);
  }

  // ---- Add custom reminder button ----
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "reminder-add-btn";
  addBtn.textContent = "+ 添加自定义提醒";
  addBtn.addEventListener("click", addCustomReminder);
  reminderTypeList.appendChild(addBtn);
}

const customModal = document.getElementById("customModal");
const customModalText = document.getElementById("customModalText");
const customModalInput = document.getElementById("customModalInput");
const customModalOk = document.getElementById("customModalOk");
const customModalCancel = document.getElementById("customModalCancel");

function showModal({ text, input = false, defaultValue = "" }) {
  return new Promise((resolve) => {
    customModalText.textContent = text;
    customModalInput.style.display = input ? "block" : "none";
    customModalInput.value = defaultValue;
    customModal.style.display = "grid";
    if (input) customModalInput.focus();

    const onOk = () => {
      cleanup();
      resolve(input ? customModalInput.value.trim() : true);
    };
    const onCancel = () => {
      cleanup();
      resolve(input ? null : false);
    };
    const onKey = (e) => {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    };

    const cleanup = () => {
      customModal.style.display = "none";
      customModalOk.removeEventListener("click", onOk);
      customModalCancel.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
    };

    customModalOk.addEventListener("click", onOk);
    customModalCancel.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
  });
}

async function addCustomReminder() {
  const label = await showModal({ text: "提醒名称（如：吃水果、开会）", input: true });
  if (!label) return;

  const id = "custom-" + Date.now();
  const result = await window.desktopPet.updateReminderConfig({
    types: [{
      id,
      label,
      mode: "interval",
      enabled: true,
      intervalMinutes: 30,
      message: `${label} 时间到！`,
      animationState: "waving",
      durationSeconds: 5
    }]
  });

  if (result.ok) {
    const next = await window.desktopPet.getReminders();
    if (next.ok) renderReminders(next.reminders);
  }
}

async function deleteReminderType(typeId) {
  const confirmed = await showModal({ text: "确定删除这个提醒吗？" });
  if (!confirmed) return;

  const result = await window.desktopPet.updateReminderConfig({
    types: [{ id: typeId, __delete: true }]
  });

  if (result.ok) {
    const next = await window.desktopPet.getReminders();
    if (next.ok) renderReminders(next.reminders);
  }
}

async function saveReminderMessage(typeId, message) {
  if (!currentReminderConfig) return;
  try {
    await window.desktopPet.updateReminderConfig({
      types: [{ id: typeId, message: String(message).slice(0, 120) }]
    });
    // Update local cache only, no full re-render to avoid losing input
    const idx = currentReminderConfig.types.findIndex((t) => t.id === typeId);
    if (idx !== -1) {
      currentReminderConfig.types[idx].message = String(message).slice(0, 120);
    }
  } catch (e) {
    console.warn("Failed to save reminder message:", e);
  }
}

async function saveReminderType(typeId, patch) {
  if (!currentReminderConfig) return;
  try {
    const result = await window.desktopPet.updateReminderConfig({
      types: [{ id: typeId, ...patch }]
    });
    if (result.ok) {
      const next = await window.desktopPet.getReminders();
      if (next.ok) renderReminders(next.reminders);
    }
  } catch (e) {
    console.warn("Failed to save reminder config:", e);
  }
}

reminderMasterToggle.addEventListener("change", async () => {
  if (!currentReminderConfig) return;
  await window.desktopPet.updateReminderConfig({ enabled: reminderMasterToggle.checked });
  const result = await window.desktopPet.getReminders();
  if (result.ok) renderReminders(result.reminders);
});

reminderQuietToggle.addEventListener("change", async () => {
  if (!currentReminderConfig) return;
  await window.desktopPet.updateReminderConfig({ quietMode: reminderQuietToggle.checked });
  const result = await window.desktopPet.getReminders();
  if (result.ok) renderReminders(result.reminders);
});

async function saveWorkHours() {
  if (!currentReminderConfig) return;
  await window.desktopPet.updateReminderConfig({
    workHours: { start: reminderWorkStart.value, end: reminderWorkEnd.value }
  });
}

reminderWorkStart.addEventListener("change", saveWorkHours);
reminderWorkEnd.addEventListener("change", saveWorkHours);

const reminderCollapseBtn = document.getElementById("reminderCollapseBtn");
const reminderPanel = document.querySelector(".reminder-panel");
reminderCollapseBtn.addEventListener("click", () => {
  reminderPanel.classList.toggle("collapsed");
});

const autoStartToggle = document.getElementById("autoStartToggle");
const greetingEnabledToggle = document.getElementById("greetingEnabledToggle");
const greetingTaskList = document.getElementById("greetingTaskList");
const greetingSayNowBtn = document.getElementById("greetingSayNowBtn");
let currentGreetingConfig = null;

function renderGreetingTasks(greeting) {
  if (!greetingTaskList) return;
  currentGreetingConfig = greeting || { enabled: true, tasks: [] };
  greetingTaskList.innerHTML = "";

  for (const task of currentGreetingConfig.tasks || []) {
    const card = document.createElement("article");
    card.className = `reminder-type-card${task.enabled ? "" : " disabled"}`;

    const row1 = document.createElement("div");
    row1.className = "reminder-top-row";

    const enable = document.createElement("input");
    enable.type = "checkbox";
    enable.checked = task.enabled !== false;
    enable.title = "启用";
    enable.addEventListener("change", () => {
      saveGreetingTask(task.id, { enabled: enable.checked });
    });

    const info = document.createElement("div");
    info.className = "reminder-info";
    info.innerHTML = `
      <div class="reminder-name">${task.label || "问候"}</div>
      <div class="greeting-task-meta">${task.kind === "startup" ? "启动时" : `每天 ${task.time || "09:00"}`}${task.triggeredToday ? " · 今天已触发" : ""}</div>
    `;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "reminder-delete";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => deleteGreetingTask(task.id));

    row1.appendChild(enable);
    row1.appendChild(info);
    row1.appendChild(delBtn);
    card.appendChild(row1);

    const controls = document.createElement("div");
    controls.className = "reminder-controls";

    const kindSelect = document.createElement("select");
    kindSelect.innerHTML = `
      <option value="scheduled">定时</option>
      <option value="startup">启动时</option>
    `;
    kindSelect.value = task.kind === "startup" ? "startup" : "scheduled";
    kindSelect.addEventListener("change", () => {
      const kind = kindSelect.value;
      timeInput.hidden = kind === "startup";
      saveGreetingTask(task.id, {
        kind,
        time: kind === "startup" ? "" : (timeInput.value || "09:00")
      });
    });
    controls.appendChild(kindSelect);

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = task.time || "09:00";
    timeInput.hidden = task.kind === "startup";
    timeInput.addEventListener("change", () => {
      saveGreetingTask(task.id, { time: timeInput.value });
    });
    controls.appendChild(timeInput);

    card.appendChild(controls);
    greetingTaskList.appendChild(card);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "reminder-add-btn";
  addBtn.textContent = "+ 添加问候任务";
  addBtn.addEventListener("click", addGreetingTask);
  greetingTaskList.appendChild(addBtn);
}

async function saveGreetingTask(taskId, patch) {
  const result = await window.desktopPet.updateLaunchSettings({
    dailyGreeting: { tasks: [{ id: taskId, ...patch }] }
  });
  if (result.ok) renderLaunchSettings(result);
}

async function deleteGreetingTask(taskId) {
  const confirmed = await showModal({ text: "确定删除这条问候任务吗？" });
  if (!confirmed) return;
  const result = await window.desktopPet.updateLaunchSettings({
    dailyGreeting: { tasks: [{ id: taskId, __delete: true }] }
  });
  if (result.ok) renderLaunchSettings(result);
}

async function addGreetingTask() {
  const label = await showModal({ text: "任务名称（如：下午茶、睡前）", input: true, defaultValue: "新问候" });
  if (!label) return;

  const id = `greeting-${Date.now()}`;
  const result = await window.desktopPet.updateLaunchSettings({
    dailyGreeting: {
      tasks: [{
        id,
        label,
        kind: "scheduled",
        enabled: true,
        time: "09:00"
      }]
    }
  });
  if (result.ok) renderLaunchSettings(result);
}

function renderLaunchSettings(payload) {
  if (!payload) return;
  autoStartToggle.checked = Boolean(payload.autoStart);
  const greeting = payload.dailyGreeting || {};
  greetingEnabledToggle.checked = greeting.enabled !== false;
  renderGreetingTasks(greeting);
}

async function saveLaunchSettings(patch = {}) {
  const result = await window.desktopPet.updateLaunchSettings(patch);
  if (result.ok) renderLaunchSettings(result);
  return result;
}

autoStartToggle.addEventListener("change", async () => {
  await saveLaunchSettings({ autoStart: autoStartToggle.checked });
});

greetingEnabledToggle.addEventListener("change", async () => {
  await saveLaunchSettings({
    dailyGreeting: { enabled: greetingEnabledToggle.checked }
  });
});

greetingSayNowBtn?.addEventListener("click", async () => {
  greetingSayNowBtn.disabled = true;
  try {
    const result = await window.desktopPet.triggerGreetingNow();
    if (!result.ok) window.alert(result.error || "触发失败");
  } catch (error) {
    window.alert(error.message || "触发失败");
  } finally {
    greetingSayNowBtn.disabled = false;
  }
});

loadSettings();
