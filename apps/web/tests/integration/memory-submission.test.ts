import assert from "node:assert/strict";
import test from "node:test";
import {
  submitNewMemoryRequest,
  type NewMemoryRequest,
} from "../../src/authoring/memorySubmission.ts";

test("memory submission imports a 2:1 panorama, uploads every medium, and runs analysis", async () => {
  const panorama = new File(["panorama-bytes"], "living-room-360.jpg", {
    type: "image/jpeg",
  });
  const firstPhoto = new File(["photo-one"], "window.jpg", {
    type: "image/jpeg",
  });
  const video = new File(["video-bytes"], "afternoon.mov", {
    type: "video/quicktime",
  });
  const audio = new File(["audio-bytes"], "room-note.m4a", {
    type: "audio/mp4",
  });
  const secondPhoto = new File(["photo-two"], "lamp.webp", {
    type: "image/webp",
  });
  const voiceRecording = new Blob(["spoken-reflection"], {
    type: "audio/webm",
  });
  const request: NewMemoryRequest = {
    sceneId: "scene / one",
    panorama: { name: panorama.name, file: panorama },
    media: [
      { name: firstPhoto.name, kind: "照片", size: "9 B", file: firstPhoto },
      { name: video.name, kind: "视频", size: "11 B", file: video },
      { name: audio.name, kind: "声音", size: "11 B", file: audio },
      { name: secondPhoto.name, kind: "照片", size: "9 B", file: secondPhoto },
    ],
    voiceRecording,
    contextText: "  午后的风吹过窗边。  ",
  };

  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async () => ({
    width: 4_000,
    height: 2_000,
    close() {},
  })) as typeof createImageBitmap;

  try {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let mediaIndex = 0;
    const fetchImplementation: typeof fetch = async (input, init = {}) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      const url = String(input);
      calls.push({ url, init });

      let response: Response;
      if (url.includes("/panorama/import?")) {
        response = Response.json({ job_id: "job_panorama", status: "completed" });
      } else if (url.includes("/media?filename=")) {
        mediaIndex += 1;
        response = Response.json({ media_id: `media_${mediaIndex}` });
      } else if (url.endsWith("/memory-requests")) {
        response = Response.json(
          {
            request_id: "memory_request_test",
            scene_id: request.sceneId,
            status: "processing",
          },
          { status: 202 },
        );
      } else if (url === "/api/jobs/job_panorama") {
        response = Response.json({ job_id: "job_panorama", status: "completed" });
      } else if (url.endsWith("/analyze")) {
        response = Response.json({ scene_id: request.sceneId, memories: [] });
      } else {
        response = Response.json({ status: "not_found" }, { status: 404 });
      }

      activeRequests -= 1;
      return response;
    };

    const receipt = await submitNewMemoryRequest(request, fetchImplementation);

    assert.equal(maximumActiveRequests, 1, "uploads must not run concurrently");
    assert.deepEqual(
      calls.map(({ url }) => url),
      [
        "/api/scenes/scene%20%2F%20one/panorama/import?width=4000&height=2000",
        "/api/scenes/scene%20%2F%20one/media?filename=window.jpg",
        "/api/scenes/scene%20%2F%20one/media?filename=afternoon.mov",
        "/api/scenes/scene%20%2F%20one/media?filename=room-note.m4a",
        "/api/scenes/scene%20%2F%20one/media?filename=lamp.webp",
        "/api/scenes/scene%20%2F%20one/media?filename=voice-recording-5.webm",
        "/api/scenes/scene%20%2F%20one/memory-requests",
        "/api/jobs/job_panorama",
        "/api/scenes/scene%20%2F%20one/analyze",
      ],
    );
    assert.equal(calls[0]?.init.body, panorama);
    assert.deepEqual(
      calls.slice(1, 5).map(({ init }) => init.body),
      [firstPhoto, video, audio, secondPhoto],
    );
    assert.ok(calls[5]?.init.body instanceof File);
    assert.equal((calls[5]?.init.body as File).name, "voice-recording-5.webm");
    assert.ok(
      calls.slice(0, 6).every(({ init }) =>
        new Headers(init.headers).get("content-type") === "application/octet-stream"
      ),
    );

    assert.deepEqual(JSON.parse(String(calls[6]?.init.body)), {
      panorama_name: "living-room-360.jpg",
      media: [
        { name: "window.jpg", kind: "照片", size: "9 B" },
        { name: "afternoon.mov", kind: "视频", size: "11 B" },
        { name: "room-note.m4a", kind: "声音", size: "11 B" },
        { name: "lamp.webp", kind: "照片", size: "9 B" },
      ],
      has_voice_recording: true,
      context_text: "午后的风吹过窗边。",
    });
    assert.deepEqual(JSON.parse(String(calls[8]?.init.body)), {
      media_ids: ["media_1", "media_2", "media_3", "media_4", "media_5"],
      context_text: "午后的风吹过窗边。",
    });

    assert.deepEqual(receipt, {
      requestId: "memory_request_test",
      sceneId: request.sceneId,
      uploadedMediaIds: ["media_1", "media_2", "media_3", "media_4", "media_5"],
      panoramaJobId: "job_panorama",
      deferredInputCount: 0,
      analysisCompleted: true,
    });
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test("INSP panorama still uses the GPU stitch route", async () => {
  const panorama = new File(["insp"], "capture.insp");
  const photo = new File(["photo"], "memory.jpg", { type: "image/jpeg" });
  const urls: string[] = [];
  let mediaIndex = 0;
  const fetchImplementation: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/media?filename=")) {
      mediaIndex += 1;
      return Response.json({ media_id: `media_${mediaIndex}` });
    }
    if (url.endsWith("/panorama/stitch")) return Response.json({ job_id: "job_insp" });
    if (url.endsWith("/memory-requests")) {
      return Response.json({
        request_id: "memory_request_insp",
        scene_id: "scene_insp",
        status: "processing",
      });
    }
    if (url === "/api/jobs/job_insp") {
      return Response.json({ job_id: "job_insp", status: "completed" });
    }
    if (url.endsWith("/analyze")) return Response.json({ scene_id: "scene_insp" });
    return Response.json({}, { status: 404 });
  };

  await submitNewMemoryRequest({
    sceneId: "scene_insp",
    panorama: { name: panorama.name, file: panorama },
    media: [{ name: photo.name, kind: "照片", size: "5 B", file: photo }],
    voiceRecording: null,
    contextText: null,
  }, fetchImplementation);

  assert.ok(urls.some((url) => url.endsWith("/panorama/stitch")));
  assert.ok(!urls.some((url) => url.includes("/panorama/import?")));
});
