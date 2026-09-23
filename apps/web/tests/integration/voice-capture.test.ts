import assert from "node:assert/strict";
import test from "node:test";
import { requestVoiceRecordingStream } from "../../src/authoring/voiceCapture.ts";

test("voice capture requests the microphone only when explicitly started", async () => {
  const calls: MediaStreamConstraints[] = [];
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  const mediaDevices = {
    async getUserMedia(constraints: MediaStreamConstraints) {
      calls.push(constraints);
      return stream;
    },
  };

  assert.equal(calls.length, 0, "opening the optional voice step requests nothing");
  assert.equal(await requestVoiceRecordingStream(mediaDevices), stream);
  assert.deepEqual(calls, [{ audio: true }]);
});

test("microphone denial remains a recoverable optional input", async () => {
  const denied = new DOMException("denied", "NotAllowedError");
  const mediaDevices = {
    async getUserMedia() {
      throw denied;
    },
  };

  await assert.rejects(requestVoiceRecordingStream(mediaDevices), denied);
});
