import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production and preview entries use one App with different Scene JSON", async () => {
  const previewEntry = await readFile(
    new URL("../../src/authoring/scene-manager-preview.tsx", import.meta.url),
    "utf8",
  );
  const productionEntry = await readFile(
    new URL("../../src/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(productionEntry, /<App \/>/);
  assert.match(previewEntry, /scene-manager-preview\.json/);
  assert.match(previewEntry, /<App initialScenes=\{previewScenes\} \/>/);
});
