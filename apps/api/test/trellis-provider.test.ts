import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpTrellisWorkerClient,
  type TrellisGenerateRequest,
} from "../src/services/hero/providers/trellis.js";

test("TRELLIS provider sends the isolated worker contract", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const provider = new HttpTrellisWorkerClient(
    "http://127.0.0.1:8002",
    1_000,
    async (input, init) => {
      calledUrl = String(input);
      calledInit = init;
      return Response.json({
        provider: "trellis",
        status: "completed",
        input_key: "scenes/one/object.png",
        output_glb_key: "scenes/one/heroes/one.glb",
        output_ply_key: null,
        seed: 3,
        elapsed_ms: 42,
        cuda_enabled: true,
      });
    },
  );
  const request: TrellisGenerateRequest = {
    input_key: "scenes/one/object.png",
    output_glb_key: "scenes/one/heroes/one.glb",
    seed: 3,
  };

  const result = await provider.generate(request);

  assert.equal(calledUrl, "http://127.0.0.1:8002/v1/hero/trellis");
  assert.equal(calledInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(calledInit?.body)), request);
  assert.equal(result.provider, "trellis");
  assert.equal(result.output_glb_key, "scenes/one/heroes/one.glb");
});

test("TRELLIS provider reports bounded worker failures", async () => {
  const provider = new HttpTrellisWorkerClient(
    "http://127.0.0.1:8002/",
    1_000,
    async () => new Response("runtime missing", { status: 503 }),
  );

  await assert.rejects(
    provider.generate({
      input_key: "object.jpg",
      output_glb_key: "hero.glb",
    }),
    /TRELLIS Worker returned 503: runtime missing/,
  );
});
