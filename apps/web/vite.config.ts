import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, statSync } from "node:fs";
import { extname, resolve } from "node:path";

const localDataDirectory = resolve(
  process.env.PLACEECHO_LOCAL_DATA_DIR ??
    resolve(import.meta.dirname, "../../.local-data"),
);
const localSceneDirectory = resolve(localDataDirectory, "scenes/scene_demo");
const localWorldDirectory = resolve(localSceneDirectory, "world");
const localMemoryDirectory = resolve(
  localSceneDirectory,
  "media/concert-preview",
);
const localMarbleDirectory = resolve(
  localDataDirectory,
  "marble/4907920b-f2b4-4362-a3ed-8e628869fd2c",
);
const localHeroDirectory = resolve(localDataDirectory, "hero-tests");
const localWorldFiles = new Set(["collider.glb", "world.spz"]);
const localMemoryFiles = new Set([
  "01-arrival.jpg",
  "02-merch.jpg",
  "03-stage-purple.jpg",
  "04-stage-blue.jpg",
  "05-clip.mp4",
  "05-clip-ambient.mp4",
]);
const localMarbleFiles = new Set([
  "collider.glb",
  "panorama.png",
  "splat-full.spz",
  "thumbnail.webp",
]);
const localHeroFiles = new Set(["IMG_0194-aholo-g1.glb"]);
const localContentTypes: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".spz": "application/octet-stream",
  ".webp": "image/webp",
};

function localSceneAssets(): Plugin {
  return {
    name: "placeecho-local-scene-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(request.url?.split("?")[0] ?? "");
        const worldFile = pathname.startsWith("/local-world/")
          ? pathname.slice("/local-world/".length)
          : "";
        const memoryFile = pathname.startsWith("/local-memory/")
          ? pathname.slice("/local-memory/".length)
          : "";
        const marbleFile = pathname.startsWith("/local-marble/")
          ? pathname.slice("/local-marble/".length)
          : "";
        const heroFile = pathname.startsWith("/local-hero/")
          ? pathname.slice("/local-hero/".length)
          : "";
        const directory = localWorldFiles.has(worldFile)
          ? localWorldDirectory
          : localMemoryFiles.has(memoryFile)
            ? localMemoryDirectory
            : localMarbleFiles.has(marbleFile)
              ? localMarbleDirectory
              : localHeroFiles.has(heroFile)
                ? localHeroDirectory
            : null;
        const fileName = directory === localWorldDirectory
          ? worldFile
          : directory === localMemoryDirectory
            ? memoryFile
            : directory === localMarbleDirectory
              ? marbleFile
              : heroFile;
        if (!directory || !fileName) {
          next();
          return;
        }

        const filePath = resolve(directory, fileName);
        try {
          const file = statSync(filePath);
          const etag = `W/"${file.size}-${Math.floor(file.mtimeMs)}"`;
          response.setHeader("ETag", etag);
          response.setHeader("Last-Modified", file.mtime.toUTCString());
          response.setHeader("Cache-Control", "private, max-age=3600");
          response.setHeader(
            "Content-Type",
            localContentTypes[extname(fileName)] ?? "application/octet-stream",
          );
          if (request.headers["if-none-match"] === etag) {
            response.statusCode = 304;
            response.end();
            return;
          }

          const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
          if (range && extname(fileName) === ".mp4") {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2]
              ? Math.min(Number(range[2]), file.size - 1)
              : file.size - 1;
            if (start < 0 || end < start || start >= file.size) {
              response.statusCode = 416;
              response.setHeader("Content-Range", `bytes */${file.size}`);
              response.end();
              return;
            }
            response.statusCode = 206;
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
            response.setHeader("Content-Length", end - start + 1);
            createReadStream(filePath, { start, end }).pipe(response);
            return;
          }
          response.setHeader("Content-Length", file.size);
          createReadStream(filePath).pipe(response);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
  };
}

export default defineConfig({
  // iOS embeds the same production bundle under an internal URL, so all
  // generated asset references must stay relative to this single entry.
  base: "./",
  plugins: [react(), localSceneAssets()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
      },
    },
  },
});
