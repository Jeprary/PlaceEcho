import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareImageForModel } from "../src/ai/image-preprocess.js";

test("large source images become bounded temporary JPEG model inputs", async () => {
  const width = 1_600;
  const height = 1_000;
  const pixels = Buffer.alloc(width * height * 3);
  let state = 0x12345678;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    pixels[index] = state & 0xff;
  }
  const source = await sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 96 }).toBuffer();
  assert.ok(source.length > 512 * 1024);

  const prepared = await prepareImageForModel(source, "source.jpg", {
    width: 640,
    height: 640,
  });
  const metadata = await sharp(prepared.bytes).metadata();

  assert.equal(prepared.mime, "image/jpeg");
  assert.equal(prepared.resized, true);
  assert.ok((metadata.width ?? Infinity) <= 640);
  assert.ok((metadata.height ?? Infinity) <= 640);
  assert.ok(prepared.bytes.length < source.length);
});

test("small inputs keep their original bytes and MIME type", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const prepared = await prepareImageForModel(bytes, "small.webp", {
    width: 640,
    height: 640,
  });
  assert.equal(prepared.bytes, bytes);
  assert.equal(prepared.mime, "image/webp");
  assert.equal(prepared.resized, false);
});
