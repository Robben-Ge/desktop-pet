const bubble = document.getElementById("bubble");
let currentItems = [];

function applyScale(scale) {
  const value = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  document.documentElement.style.setProperty("--bubble-scale", String(value));
}

function measure() {
  if (currentItems.length === 0) return;
  const rect = bubble.getBoundingClientRect();
  window.desktopPet.measureBubble({
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height)
  });
}

function renderItems(items) {
  bubble.innerHTML = "";
  currentItems = Array.isArray(items) ? items.filter((item) => item?.message) : [];

  for (const item of currentItems) {
    const card = document.createElement("section");
    card.className = `bubble-card ${item.state || "idle"}`;

    if (item.title || item.source) {
      const head = document.createElement("div");
      head.className = "bubble-head";
      const source = document.createElement("span");
      source.className = "bubble-source";
      source.textContent = item.title || item.source;
      const state = document.createElement("span");
      state.className = "bubble-state";
      state.textContent = item.state || "";
      head.appendChild(source);
      head.appendChild(state);
      card.appendChild(head);
    }

    const text = document.createElement("div");
    text.className = "bubble-text";
    text.textContent = item.message;
    card.appendChild(text);
    bubble.appendChild(card);
  }
}

window.desktopPet.onBubbleMessage((payload) => {
  applyScale(payload?.bubbleScale || 1);
  renderItems(payload?.items || (payload?.message ? [{ message: payload.message }] : []));
  requestAnimationFrame(measure);
});

window.desktopPet.onBubbleScaleChange((payload) => {
  applyScale(payload?.bubbleScale || 1);
  requestAnimationFrame(measure);
});
