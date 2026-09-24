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

const LiveSceneExperience = lazy(() =>
  import("./authoring/LiveSceneExperience").then((module) => ({
    default: module.LiveSceneExperience,
  })),
);

type LocalPreviewConfig = {
  scenes: Scene[];
};

const previewConfig = previewConfigFixture as unknown as LocalPreviewConfig;
const search = new URLSearchParams(window.location.search);
const groundingSceneId = search.get("groundingScene");
const experienceSceneId = search.get("experienceScene");
const experienceMemoryId = search.get("memoryId");
const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
const groundingApiBaseUrl = search.get("apiBase") ?? configuredApiBaseUrl;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {experienceSceneId ? (
      <Suspense fallback={<main className="grounding-verification" />}>
        <LiveSceneExperience
          sceneId={experienceSceneId}
          apiBaseUrl={groundingApiBaseUrl}
          requestedMemoryId={experienceMemoryId}
        />
      </Suspense>
    ) : groundingSceneId ? (
      <Suspense fallback={<main className="grounding-verification" />}>
        <GroundingVerification
          sceneId={groundingSceneId}
          apiBaseUrl={groundingApiBaseUrl}
        />
      </Suspense>
    ) : (
      <App
        initialScenes={previewConfig.scenes}
        apiBaseUrl={groundingApiBaseUrl}
      />
    )}
  </StrictMode>,
);
