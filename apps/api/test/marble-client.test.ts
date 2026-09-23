import assert from "node:assert/strict";
import test from "node:test";

import { HttpMarbleClient } from "../src/services/marble/client.js";

test("uses Marble 1.1 Plus by default for panorama generation", async (t) => {
  const originalFetch = globalThis.fetch;
  let submittedBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ operation_id: "operation_one" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpMarbleClient("test-key");
  const operationId = await client.generateFromPanorama(Buffer.from("panorama"));

  assert.equal(operationId, "operation_one");
  assert.equal(submittedBody?.model, "marble-1.1-plus");
});
