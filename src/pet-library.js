const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const STORAGE_LABELS = {
  codex: ".codex 宠物",
  custom: "自定义文件夹"
};

const PET_SOURCE_LABELS = {
  builtin: "内置",
  pets: "目录"
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

function getPetStorageRoots({ codexHome, customPetsDir }) {
  return {
    codexPetsRoot: path.join(codexHome, "pets"),
    customPetsRoot: customPetsDir ? path.resolve(customPetsDir) : ""
  };
}

function normalizePetStorage(value, roots) {
  if (value === "custom" && roots.customPetsRoot) return "custom";
  return "codex";
}

function getActivePetsRoot({ codexHome, settings = {} }) {
  const roots = getPetStorageRoots({
    codexHome,
    customPetsDir: settings.customPetsDir
  });
  const petStorage = normalizePetStorage(settings.petStorage, roots);
  const petsRoot = petStorage === "custom" ? roots.customPetsRoot : roots.codexPetsRoot;

  return {
    petStorage,
    petsRoot,
    ...roots,
    options: [
      { id: "codex", label: STORAGE_LABELS.codex, path: roots.codexPetsRoot },
      { id: "custom", label: STORAGE_LABELS.custom, path: roots.customPetsRoot }
    ]
  };
}

function normalizeSpriteVersion(value) {
  const version = Number(value);
  if (version === 1) return 1;
  return 2;
}

function atlasRowsForVersion(spriteVersionNumber) {
  return normalizeSpriteVersion(spriteVersionNumber) === 1 ? 9 : 11;
}

function discoverPetsInDirectory(petsRoot, source = "pets") {
  const prefix = source === "builtin" ? "builtin" : "pets";
  return listDirectories(petsRoot)
    .map((dir) => {
      const manifest = readJson(path.join(dir, "pet.json")) || {};
      const id = String(manifest.id || path.basename(dir));
      const spritesheetPath = path.resolve(dir, manifest.spritesheetPath || "spritesheet.webp");
      const spriteVersionNumber = normalizeSpriteVersion(manifest.spriteVersionNumber);

      if (!fs.existsSync(spritesheetPath)) return null;

      return {
        id,
        key: `${prefix}:${id}`,
        displayName: String(manifest.displayName || id),
        description: String(manifest.description || ""),
        spriteVersionNumber,
        atlasRows: atlasRowsForVersion(spriteVersionNumber),
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
  return [
    ...bundledPets,
    ...discoverPetsInDirectory(petsRoot, "pets")
  ];
}

function toPetPayload(pet) {
  if (!pet) return null;
  const spriteVersionNumber = normalizeSpriteVersion(pet.spriteVersionNumber);
  return {
    id: pet.id,
    key: pet.key,
    displayName: pet.displayName,
    description: pet.description,
    spriteVersionNumber,
    atlasRows: pet.atlasRows || atlasRowsForVersion(spriteVersionNumber),
    source: pet.source,
    sourceLabel: pet.sourceLabel,
    root: pet.root,
    spritesheetPath: pet.spritesheetPath,
    spritesheetUrl: pathToFileURL(pet.spritesheetPath).toString()
  };
}

module.exports = {
  atlasRowsForVersion,
  discoverPets,
  getActivePetsRoot,
  normalizeSpriteVersion,
  sanitizeId,
  toPetPayload
};
