import assert from "node:assert/strict";
import test from "node:test";
import {
  getDeferredMemoryInputs,
  submitNewMemoryRequest,
  type NewMemoryRequest,
} from "../../src/authoring/memorySubmission.ts";

test("memory submission uploads supported binaries in order and defers unsupported inputs intact", async () => {
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

  const calls: Array<{ url: string; init: RequestInit }> = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let mediaIndex = 0;
  const fetchImplementation: typeof fetch = async (input, init = {}) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    calls.push({ url: String(input), init });

    let response: Response;
    if (String(input).includes("/media?filename=")) {
      mediaIndex += 1;
      response = Response.json({ media_id: `media_${mediaIndex}` });
    } else if (String(input).endsWith("/panorama/stitch")) {
      response = Response.json({ job_id: "job_panorama" });
    } else {
      response = Response.json(
        {
          request_id: "memory_request_test",
          scene_id: request.sceneId,
          status: "processing",
        },
        { status: 202 },
      );
    }

    activeRequests -= 1;
    return response;
  };

  const receipt = await submitNewMemoryRequest(request, fetchImplementation);

  assert.equal(maximumActiveRequests, 1, "uploads must not run concurrently");
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      "/api/scenes/scene%20%2F%20one/media?filename=living-room-360.jpg",
      "/api/scenes/scene%20%2F%20one/media?filename=window.jpg",
      "/api/scenes/scene%20%2F%20one/media?filename=lamp.webp",
      "/api/scenes/scene%20%2F%20one/panorama/stitch",
      "/api/scenes/scene%20%2F%20one/memory-requests",
    ],
  );
  assert.deepEqual(
    calls.slice(0, 3).map(({ init }) => init.body),
    [panorama, firstPhoto, secondPhoto],
    "the original File objects must cross the upload boundary unchanged",
  );
  assert.ok(
    calls.slice(0, 3).every(({ init }) =>
      init.headers &&
      new Headers(init.headers).get("content-type") === "application/octet-stream"
    ),
  );

  assert.deepEqual(JSON.parse(String(calls[3]?.init.body)), {
    media_ids: ["media_1"],
    enable_stitch_fusion: false,
  });
  assert.deepEqual(JSON.parse(String(calls[4]?.init.body)), {
    panorama_name: "living-room-360.jpg",
    media: [
      { name: "window.jpg", kind: "照片", size: "9 B" },
      { name: "afternoon.mov", kind: "视频", size: "11 B" },
      { name: "room-note.m4a", kind: "声音", size: "11 B" },
      { name: "lamp.webp", kind: "照片", size: "9 B" },
    ],
    has_voice_recording: true,
  });

  assert.deepEqual(receipt, {
    requestId: "memory_request_test",
    sceneId: request.sceneId,
    uploadedMediaIds: ["media_2", "media_3"],
    panoramaJobId: "job_panorama",
    deferredInputCount: 4,
  });

  const deferred = getDeferredMemoryInputs(receipt.requestId);
  assert.ok(deferred);
  assert.deepEqual(deferred.media, [request.media[1], request.media[2]]);
  assert.equal(deferred.media[0]?.file, video);
  assert.equal(deferred.media[1]?.file, audio);
  assert.equal(deferred.voiceRecording, voiceRecording);
  assert.equal(deferred.contextText, "午后的风吹过窗边。");

  const uploadedBodies = calls.slice(0, 3).map(({ init }) => init.body);
  assert.ok(!uploadedBodies.includes(video));
  assert.ok(!uploadedBodies.includes(audio));
  assert.ok(!uploadedBodies.includes(voiceRecording));
  assert.ok(
    !calls.some(({ init }) => String(init.body).includes("午后的风吹过窗边")),
    "deferred text must not be disguised as an uploaded asset",
  );
});
