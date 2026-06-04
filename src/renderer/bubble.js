const bubble = document.getElementById("bubble");
let currentMessage = "";

function applyScale(scale) {
  const value = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  document.documentElement.style.setProperty("--bubble-scale", String(value));
}

function measure() {
  if (!currentMessage) return;
  const rect = bubble.getBoundingClientRect();
  window.desktopPet.measureBubble({
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height)
  });
}

window.desktopPet.onBubbleMessage((payload) => {
  applyScale(payload?.bubbleScale || 1);
  currentMessage = payload?.message || "";
  bubble.textContent = currentMessage;
  requestAnimationFrame(measure);
});

window.desktopPet.onBubbleScaleChange((payload) => {
  applyScale(payload?.bubbleScale || 1);
  requestAnimationFrame(measure);
});
