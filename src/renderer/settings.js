const apiInfo = document.getElementById("apiInfo");
const refreshBtn = document.getElementById("refreshBtn");
const petCount = document.getElementById("petCount");
const petList = document.getElementById("petList");
const actionGrid = document.getElementById("actionGrid");
const zoomInfo = document.getElementById("zoomInfo");
const bubbleInfo = document.getElementById("bubbleInfo");
const petsRoot = document.getElementById("petsRoot");
const petRunsRoot = document.getElementById("petRunsRoot");
const settingsPath = document.getElementById("settingsPath");

let activePetKey = "";
let zoom = 1;
let bubbleScale = 1;

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
