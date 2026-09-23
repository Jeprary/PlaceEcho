import assert from "node:assert/strict";
import test from "node:test";
import { HttpSam3Preprocessor } from "../src/services/hero/preprocessors/sam3.js";
import { HttpTrellis2Provider } from "../src/services/hero/providers/trellis2.js";

test("SAM 3 adapter sends normalized prompts and storage keys", async () => {
  let received: Record<string, unknown> | null = null;
  const fakeFetch: typeof fetch = async (_input, init) => {
    received = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        status: "completed",
        mask_key: "heroes/one/mask.png",
        width: 1024,
        height: 1024,
        score: 0.91,
        elapsed_ms: 25,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const sam3 = new HttpSam3Preprocessor("http://sam3.internal:8000", fakeFetch);

  const result = await sam3.createMask({
    input_key: "heroes/one/input.jpg",
    output_mask_key: "heroes/one/mask.png",
    prompt: { type: "point", x: 0.25, y: 0.75, label: "foreground" },
  });

  assert.equal(result.mask_key, "heroes/one/mask.png");
  assert.deepEqual(received, {
    input_key: "heroes/one/input.jpg",
    output_mask_key: "heroes/one/mask.png",
    prompt: { type: "point", x: 0.25, y: 0.75, label: "foreground" },
  });
});

test("SAM 3 adapter rejects invalid prompts before a network call", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  const sam3 = new HttpSam3Preprocessor("http://sam3.internal:8000", fakeFetch);

  await assert.rejects(
    sam3.createMask({
      input_key: "heroes/input.jpg",
      output_mask_key: "heroes/mask.png",
      prompt: { type: "box", x_min: 0.8, y_min: 0.1, x_max: 0.2, y_max: 0.9 },
    }),
    /positive width and height/,
  );
  assert.equal(called, false);
});

test("TRELLIS.2 adapter supports one image with an optional SAM 3 mask", async () => {
  let received: Record<string, unknown> | null = null;
  const fakeFetch: typeof fetch = async (_input, init) => {
    received = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        status: "completed",
        asset_key: "heroes/one/model.glb",
        format: "glb",
        elapsed_ms: 1000,
        peak_vram_mib: 22000,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const provider = new HttpTrellis2Provider("http://trellis2.internal:8000", fakeFetch);

  const result = await provider.generate({
    input_key: "heroes/one/input.jpg",
    mask_key: "heroes/one/mask.png",
    output_key: "heroes/one/model.glb",
    seed: 7,
  });

  assert.equal(result.asset_key, "heroes/one/model.glb");
  assert.deepEqual(received, {
    input_key: "heroes/one/input.jpg",
    mask_key: "heroes/one/mask.png",
    output_key: "heroes/one/model.glb",
    seed: 7,
  });
});

test("TRELLIS.2 adapter rejects traversal and non-GLB output", async () => {
  const provider = new HttpTrellis2Provider(
    "http://trellis2.internal:8000",
    async () => new Response("{}", { status: 200 }),
  );
  await assert.rejects(
    provider.generate({ input_key: "../secret.jpg", output_key: "hero.glb" }),
    /safe relative storage key/,
  );
  await assert.rejects(
    provider.generate({ input_key: "hero.jpg", output_key: "hero.ply" }),
    /must end with .glb/,
  );
});
