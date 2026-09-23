import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { StorageProvider } from "../src/storage/provider.js";

class MemoryStorage implements StorageProvider {
  readonly records = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.records.set(key, new Uint8Array(data));
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.records.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

test("application generates and persists a processing Memory request", async (t) => {
  const storage = new MemoryStorage();
  const app = buildApp({ storageProvider: storage, logger: false });
  t.after(async () => app.close());

  const sceneResponse = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = sceneResponse.json<{ scene_id: string }>().scene_id;
  const response = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/memory-requests`,
    payload: {
      panorama_name: "living-room-360.jpg",
      media: [{ name: "window.jpg", kind: "照片", size: "2.4 MB" }],
      has_voice_recording: false,
    },
  });

  assert.equal(response.statusCode, 202);
  const body = response.json<{
    request_id: string;
    scene_id: string;
    status: string;
  }>();
  assert.match(body.request_id, /^memory_request_/);
  assert.equal(body.scene_id, sceneId);
  assert.equal(body.status, "processing");
  const key = `scenes/${sceneId}/memory-requests/${body.request_id}.json`;
  const bytes = storage.records.get(key);
  assert.ok(bytes);
  assert.equal(
    JSON.parse(new TextDecoder().decode(bytes)).request_id,
    body.request_id,
  );
});

test("a Memory request cannot be attached to a missing Scene", async (t) => {
  const app = buildApp({ storageProvider: new MemoryStorage(), logger: false });
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/scenes/scene_missing/memory-requests",
    payload: {
      panorama_name: "room.jpg",
      media: [{ name: "a.jpg", kind: "照片", size: "1 MB" }],
      has_voice_recording: false,
    },
  });

  assert.equal(response.statusCode, 404);
});
