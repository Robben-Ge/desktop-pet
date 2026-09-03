const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ATLAS_ROWS = 11;
const ATLAS_COLS = 8;

const PET_SOURCE_LABELS = {
  builtin: "内置",
  pets: "自定义"
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listDirectories(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function sanitizeId(input, fallback = "pet") {
  const base = String(input || fallback)
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || fallback;
}

function getActivePetsRoot({ settings = {} } = {}) {
  const customPetsRoot = settings.customPetsDir
    ? path.resolve(String(settings.customPetsDir))
    : "";

  return {
    petStorage: customPetsRoot ? "custom" : "",
    petsRoot: customPetsRoot,
    customPetsRoot
  };
}

function discoverPetsInDirectory(petsRoot, source = "pets") {
  const prefix = source === "builtin" ? "builtin" : "pets";
  return listDirectories(petsRoot)
    .map((dir) => {
      const manifest = readJson(path.join(dir, "pet.json")) || {};
      const id = String(manifest.id || path.basename(dir));
      const spritesheetPath = path.resolve(dir, manifest.spritesheetPath || "spritesheet.webp");

      if (!fs.existsSync(spritesheetPath)) return null;

      return {
        id,
        key: `${prefix}:${id}`,
        displayName: String(manifest.displayName || id),
        description: String(manifest.description || ""),
        atlasRows: ATLAS_ROWS,
        atlasCols: ATLAS_COLS,
        source,
        sourceLabel: PET_SOURCE_LABELS[source] || source,
        root: dir,
        spritesheetPath
      };
    })
    .filter(Boolean);
}

function discoverPets(petsRoot, options = {}) {
  const bundledPets = options.bundledPetsRoot
    ? discoverPetsInDirectory(options.bundledPetsRoot, "builtin")
    : [];
  const customPets = petsRoot
    ? discoverPetsInDirectory(petsRoot, "pets")
    : [];
  return [...bundledPets, ...customPets];
}

function toPetPayload(pet) {
  if (!pet) return null;
  return {
    id: pet.id,
    key: pet.key,
    displayName: pet.displayName,
    description: pet.description,
    atlasRows: ATLAS_ROWS,
    atlasCols: ATLAS_COLS,
    source: pet.source,
    sourceLabel: pet.sourceLabel,
    root: pet.root,
    spritesheetPath: pet.spritesheetPath,
    spritesheetUrl: pathToFileURL(pet.spritesheetPath).toString()
  };
}

module.exports = {
  ATLAS_COLS,
  ATLAS_ROWS,
  discoverPets,
  getActivePetsRoot,
  sanitizeId,
  toPetPayload
};
