import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "../../..");
const sourcePath = path.resolve(
  repositoryRoot,
  process.argv[2] ?? ".local-data/scenes/scene_demo/world/world.ply",
);
const outputPath = path.resolve(
  repositoryRoot,
  process.argv[3] ?? ".local-data/scenes/scene_demo/world/world.spz",
);

// Spark 2.2's public transcoder applies an identity transform even when none is
// requested. That transform currently fails for valid degree-zero-SH PLY files.
// Use the same pinned Spark decoder and encoder while deliberately skipping the
// no-op transform. This also produces a plain SPZ without LoD parent splats.
const sparkModulePath = fileURLToPath(import.meta.resolve("@sparkjsdev/spark"));
const temporaryDirectory = await mkdtemp(
  path.join(currentDirectory, ".spark-transcode-"),
);
const patchedModulePath = path.join(temporaryDirectory, "spark-transcode.mjs");

try {
  const sparkSource = await readFile(sparkModulePath, "utf8");
  await writeFile(
    patchedModulePath,
    `${sparkSource}\nexport { decode_to_gsplatarray as __decodeToGsplatArray, initialization as __sparkInitialization };\n`,
  );

  const { __decodeToGsplatArray, __sparkInitialization } = await import(
    pathToFileURL(patchedModulePath).href
  );
  await __sparkInitialization;

  const sourceBytes = await readFile(sourcePath);
  const decoder = __decodeToGsplatArray("ply", sourcePath);
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < sourceBytes.length; offset += chunkSize) {
    decoder.push(
      sourceBytes.subarray(offset, Math.min(offset + chunkSize, sourceBytes.length)),
    );
  }

  const splats = decoder.finish();
  if (splats.has_lod()) {
    throw new Error("Expected the source PLY to contain no LoD hierarchy.");
  }

  const outputBytes = splats.encode_to_spz(0, 12);
  await writeFile(outputPath, outputBytes);
  console.log(`SPZ world: ${outputPath} (${outputBytes.length} bytes)`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
