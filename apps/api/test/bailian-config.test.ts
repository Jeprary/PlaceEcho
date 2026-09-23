import assert from "node:assert/strict";
import test from "node:test";
import { bailianCompatibleBaseUrl } from "../src/ai/memory/bailian.js";
import { CommandPanoramaCleaner } from "../src/jobs/panorama-cleaner.js";

test("normalizes a console workspace API Host for OpenAI-compatible calls", () => {
  assert.equal(
    bailianCompatibleBaseUrl({
      BAILIAN_API_HOST: "workspace.cn-beijing.maas.aliyuncs.com",
    }),
    "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    bailianCompatibleBaseUrl({
      BAILIAN_API_HOST:
        "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/",
    }),
    "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
});

test("panorama cleaner accepts the legacy Bailian key and bare workspace host", () => {
  const previous = {
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL: process.env.DASHSCOPE_BASE_URL,
    BAILIAN_API_KEY: process.env.BAILIAN_API_KEY,
    BAILIAN_API_HOST: process.env.BAILIAN_API_HOST,
  };
  try {
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_BASE_URL;
    process.env.BAILIAN_API_KEY = "test-only-key";
    process.env.BAILIAN_API_HOST =
      "workspace.cn-beijing.maas.aliyuncs.com";
    assert.equal(
      new CommandPanoramaCleaner("python3", ".", "config.json").isConfigured(),
      true,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
