import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

const localWorldDirectory = resolve(
  import.meta.dirname,
  "../../.local-data/scenes/scene_demo/world",
);

function localWorldAssets(): Plugin {
  return {
    name: "placeecho-local-world-assets",
    configureServer(server) {
      server.middlewares.use(
        "/local-world",
        (request, response, next) => {
          const fileName = decodeURIComponent(request.url?.split("?")[0] ?? "").replace(
            /^\//,
            "",
          );
          const isWorldAsset =
            fileName === "collider.glb" ||
            fileName === "world.spz";
          if (!isWorldAsset) {
            next();
            return;
          }

          const filePath = resolve(localWorldDirectory, fileName);
          try {
            const file = statSync(filePath);
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Content-Length", file.size);
            response.setHeader("Cache-Control", "no-store");
            createReadStream(filePath).pipe(response);
          } catch {
            response.statusCode = 404;
            response.end();
          }
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), localWorldAssets()],
});
