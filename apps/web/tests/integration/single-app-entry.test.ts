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
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /black-translucent/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(entry, /scene-manager-preview\.json/);
  assert.match(entry, /VITE_PLACEECHO_PUBLIC_DEMO/);
  assert.match(entry, /scene\.scene_id === "scene_demo"/);
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

test("New Memory authoring opens before the backend assigns a Scene ID", async () => {
  const manager = await readFile(
    new URL("../../src/authoring/SceneManagerPreview.tsx", import.meta.url),
    "utf8",
  );

  const beginCreate = manager.slice(
    manager.indexOf("function beginCreate"),
    manager.indexOf("async function createMemory"),
  );
  assert.match(beginCreate, /setView\("create"\)/);
  assert.match(beginCreate, /ensureDraftScene\(\)\.catch/);
  assert.doesNotMatch(manager, /if \(!draftSceneId\) return null/);
  assert.doesNotMatch(manager, /后端暂未连接/);
  assert.match(manager, /暂时无法保存，请稍后重试/);
});
