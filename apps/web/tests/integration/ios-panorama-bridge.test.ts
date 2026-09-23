import assert from "node:assert/strict";
import test from "node:test";
import { parseIOSNativeMessage } from "../../src/world/iosPanoramaMessage.ts";
import { createHTTPPanoramaSyncPort } from "../../src/world/panoramaSync.ts";

const captureURL =
  "placeecho://capture/123e4567-e89b-12d3-a456-426614174000.jpg";

test("iOS bridge accepts only an allowlisted app-local panorama as device-only", () => {
  assert.deepEqual(parseIOSNativeMessage({
    type: "panorama_ready",
    scene_id: "scene_device",
    url: captureURL,
    width: 8_600,
    height: 4_300,
    availability: "device",
  }), {
    type: "panorama_ready",
    scene_id: "scene_device",
    url: captureURL,
    width: 8_600,
    height: 4_300,
    availability: "device",
  });

  const rejected = [
    { url: "file:///private/capture.jpg", availability: "device" },
    { url: "data:image/jpeg;base64,AAAA", availability: "device" },
    { url: "AAAA/BBBB", availability: "device" },
    { url: "other://capture/123e4567-e89b-12d3-a456-426614174000.jpg", availability: "device" },
    { url: "placeecho://other/123e4567-e89b-12d3-a456-426614174000.jpg", availability: "device" },
    { url: "placeecho://capture/not-a-uuid.jpg", availability: "device" },
    { url: captureURL, availability: "durable" },
    { url: "http://example.com/capture.jpg", availability: "durable" },
  ] as const;
  rejected.forEach((message) => {
    assert.equal(parseIOSNativeMessage({
      type: "panorama_ready",
      scene_id: "scene_rejected",
      width: 4_000,
      height: 2_000,
      ...message,
    }), null);
  });
});

test("iOS bridge accepts a durable panorama only from HTTPS", () => {
  assert.deepEqual(parseIOSNativeMessage({
    type: "panorama_ready",
    scene_id: "scene_durable",
    url: "https://cdn.example.com/scenes/scene_durable/panorama.jpg",
    width: 4_000,
    height: 2_000,
    availability: "durable",
  }), {
    type: "panorama_ready",
    scene_id: "scene_durable",
    url: "https://cdn.example.com/scenes/scene_durable/panorama.jpg",
    width: 4_000,
    height: 2_000,
    availability: "durable",
  });
});

test("device panorama sync stays explicit and uses the import API boundary", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === captureURL) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    return Response.json({ job_id: "job_device_sync" }, { status: 201 });
  };
  const port = createHTTPPanoramaSyncPort(fetchImpl);
  assert.equal(calls.length, 0, "creating the port must not start a sync");

  const receipt = await port.startDeviceSync({
    sceneId: "scene / device",
    url: captureURL,
    width: 8_600,
    height: 4_300,
    source: "ios_capture",
    availability: "device",
  });

  assert.deepEqual(receipt, {
    sceneId: "scene / device",
    jobId: "job_device_sync",
  });
  assert.deepEqual(calls.map(({ url }) => url), [
    captureURL,
    "/api/scenes/scene%20%2F%20device/panorama/import?width=8600&height=4300",
  ]);
  assert.equal(calls[1]?.init?.method, "POST");
  assert.equal(
    new Headers(calls[1]?.init?.headers).get("content-type"),
    "application/octet-stream",
  );
});
