const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ATLAS_ROWS,
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
  const petsRoot = path.join(root, "custom-pets");
  writePet(petsRoot, "boba");

  const pets = discoverPets(petsRoot);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, "boba");
  assert.equal(pets[0].source, "pets");
  assert.equal(pets[0].atlasRows, ATLAS_ROWS);
});

test("discoverPets includes bundled pets with stable keys", () => {
  const root = tempDir();
  const bundledPetsRoot = path.join(root, "app", "assets", "pets");
  const petsRoot = path.join(root, "custom-pets");
  writePet(bundledPetsRoot, "starter");
  writePet(petsRoot, "starter");

  const pets = discoverPets(petsRoot, { bundledPetsRoot });

  assert.equal(pets.length, 2);
  assert.deepEqual(pets.map((pet) => pet.source), ["builtin", "pets"]);
  assert.deepEqual(pets.map((pet) => pet.key), ["builtin:starter", "pets:starter"]);
});

test("getActivePetsRoot returns empty root when custom folder is unset", () => {
  const storage = getActivePetsRoot({ settings: {} });
  assert.equal(storage.petsRoot, "");
  assert.equal(storage.customPetsRoot, "");
});

test("getActivePetsRoot supports a configured custom folder", () => {
  const root = tempDir();
  const customPetsDir = path.join(root, "custom-pets");

  const storage = getActivePetsRoot({
    settings: { customPetsDir }
  });

  assert.equal(storage.petStorage, "custom");
  assert.equal(storage.petsRoot, customPetsDir);
  assert.equal(storage.customPetsRoot, customPetsDir);
});

test("sanitizeId keeps ids filesystem-safe", () => {
  assert.equal(sanitizeId("hello / world"), "hello-world");
});
