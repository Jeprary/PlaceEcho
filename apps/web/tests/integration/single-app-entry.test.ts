import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Web product has one HTML shell and one React bootstrap", async () => {
  const entry = await readFile(
    new URL("../../src/main.tsx", import.meta.url),
    "utf8",
  );
  const html = await readFile(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /id="root"/);
  assert.match(entry, /scene-manager-preview\.json/);
  assert.match(entry, /<App/);
  await assert.rejects(
    readFile(new URL("../../scene-manager-preview.html", import.meta.url)),
  );
});
