import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { Scene } from "@placeecho/shared";
import previewConfigFixture from "../../../assets/demo/scene-manager-preview.json";
import { App } from "./App";
import "./styles.css";

const GroundingVerification = lazy(() =>
  import("./authoring/GroundingVerification").then((module) => ({
    default: module.GroundingVerification,
  })),
);

type LocalPreviewConfig = {
  scenes: Scene[];
};

const previewConfig = previewConfigFixture as unknown as LocalPreviewConfig;
const initialScenes = import.meta.env.VITE_PLACEECHO_PUBLIC_DEMO === "1"
  ? previewConfig.scenes.filter((scene) => scene.scene_id === "scene_demo")
  : previewConfig.scenes;
const search = new URLSearchParams(window.location.search);
const groundingSceneId = search.get("groundingScene");
const groundingApiBaseUrl = search.get("apiBase") ?? "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {groundingSceneId ? (
      <Suspense fallback={<main className="grounding-verification" />}>
        <GroundingVerification
          sceneId={groundingSceneId}
          apiBaseUrl={groundingApiBaseUrl}
        />
      </Suspense>
    ) : (
      <App initialScenes={initialScenes} />
    )}
  </StrictMode>,
);
