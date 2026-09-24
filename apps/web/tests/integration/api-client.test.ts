import assert from "node:assert/strict";
import test from "node:test";
import { createApiFetch } from "../../src/api/client.ts";

test("the configured API origin prefixes only PlaceEcho API requests", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(null, { status: 204 });
  };
  const apiFetch = createApiFetch("https://api.placeecho.test/", fetchImpl);

  await apiFetch("/api/scenes");
  await apiFetch("https://cdn.example.test/world.spz");

  assert.deepEqual(calls, [
    "https://api.placeecho.test/api/scenes",
    "https://cdn.example.test/world.spz",
  ]);
});
