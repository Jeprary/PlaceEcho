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

test("sensitive device permissions remain behind explicit user actions", async () => {
  const app = await readFile(
    new URL("../../src/App.tsx", import.meta.url),
    "utf8",
  );
  const creation = await readFile(
    new URL("../../src/authoring/NewMemoryFlow.tsx", import.meta.url),
    "utf8",
  );

  const openMemoryStart = app.indexOf("const openMemory");
  const motionRequest = app.indexOf("await requestDeviceOrientationPermission");
  assert.ok(openMemoryStart >= 0 && motionRequest > openMemoryStart);
  assert.doesNotMatch(app.slice(0, openMemoryStart), /requestDeviceOrientationPermission\(\)/);

  const recordingStart = creation.indexOf("async function startRecording");
  const microphoneRequest = creation.indexOf("requestVoiceRecordingStream()", recordingStart);
  assert.ok(recordingStart >= 0 && microphoneRequest > recordingStart);
  assert.match(creation, /录音.*选填|选填.*录音/);
  assert.match(creation, /麦克风未授权，可跳过/);
});
