const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  discoverPets,
  getActivePetsRoot,
  sanitizeId
} = require("../src/pet-library");

const WEBP = Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "binary");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-test-"));
}

function writePet(root, id, extras = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "spritesheet.webp"), WEBP);
  fs.writeFileSync(path.join(dir, "pet.json"), JSON.stringify({
    id,
    displayName: `Pet ${id}`,
    spritesheetPath: "spritesheet.webp",
    ...extras
  }));
}

test("discoverPets reads only the provided pets root", () => {
  const root = tempDir();
  const petsRoot = path.join(root, ".codex", "pets");
  const runsRoot = path.join(root, ".codex", "pet-runs");
  writePet(petsRoot, "boba");
  writePet(path.join(runsRoot, "run-1", "final"), "generated");

  const pets = discoverPets(petsRoot);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, "boba");
  assert.equal(pets[0].source, "pets");
});

test("discoverPets includes bundled pets with stable keys", () => {
  const root = tempDir();
  const bundledPetsRoot = path.join(root, "app", "assets", "pets");
  const petsRoot = path.join(root, ".codex", "pets");
  writePet(bundledPetsRoot, "starter");
  writePet(petsRoot, "starter");

  const pets = discoverPets(petsRoot, { bundledPetsRoot });

  assert.equal(pets.length, 2);
  assert.deepEqual(pets.map((pet) => pet.source), ["builtin", "pets"]);
  assert.deepEqual(pets.map((pet) => pet.key), ["builtin:starter", "pets:starter"]);
});

test("getActivePetsRoot defaults to .codex pets", () => {
  const root = tempDir();
  const codexHome = path.join(root, ".codex");

  assert.equal(getActivePetsRoot({ codexHome, settings: {} }).petsRoot, path.join(codexHome, "pets"));
});

test("getActivePetsRoot supports a configured custom folder", () => {
  const root = tempDir();
  const codexHome = path.join(root, ".codex");
  const customPetsDir = path.join(root, "custom-pets");

  const storage = getActivePetsRoot({
    codexHome,
    settings: {
      petStorage: "custom",
      customPetsDir
    }
  });

  assert.equal(storage.petStorage, "custom");
  assert.equal(storage.petsRoot, customPetsDir);
  assert.deepEqual(storage.options.map((option) => option.id), ["codex", "custom"]);
});

test("getActivePetsRoot falls back to .codex when custom folder is missing", () => {
  const root = tempDir();
  const codexHome = path.join(root, ".codex");

  const storage = getActivePetsRoot({
    codexHome,
    settings: {
      petStorage: "custom"
    }
  });

  assert.equal(storage.petStorage, "codex");
  assert.equal(storage.petsRoot, path.join(codexHome, "pets"));
});

test("discoverPets defaults to sprite version 2", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "pets");
  writePet(petsRoot, "v2-pet");

  const pets = discoverPets(petsRoot);
  assert.equal(pets[0].spriteVersionNumber, 2);
  assert.equal(pets[0].atlasRows, 11);
});

test("discoverPets keeps sprite version 1 atlas rows", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "pets");
  writePet(petsRoot, "v1-pet", { spriteVersionNumber: 1 });

  const pets = discoverPets(petsRoot);
  assert.equal(pets[0].spriteVersionNumber, 1);
  assert.equal(pets[0].atlasRows, 9);
});

test("sanitizeId keeps ids filesystem-safe", () => {
  assert.equal(sanitizeId("hello / world"), "hello-world");
});
