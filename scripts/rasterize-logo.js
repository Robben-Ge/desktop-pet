const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const svgPath = path.join(root, "src", "assets", "logo.svg");
const outPath = path.join(root, "src", "assets", "logo.png");
const svg = fs.readFileSync(svgPath, "utf8");
const html = `<!doctype html><html><head><style>
html,body{margin:0;padding:0;width:512px;height:512px;background:transparent;overflow:hidden;}
svg{display:block;width:512px;height:512px;}
</style></head><body>${svg}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true }
  });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(outPath, image.toPNG());
  console.log("WROTE", outPath, JSON.stringify(image.getSize()));
  app.quit();
});
