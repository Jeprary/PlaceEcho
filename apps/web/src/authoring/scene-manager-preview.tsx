import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Scene } from "@placeecho/shared";
import previewScenesFixture from "../../../../assets/demo/scene-manager-preview.json";
import { App } from "../App";
import "../styles.css";

const previewScenes = previewScenesFixture as unknown as Scene[];

createRoot(document.getElementById("scene-manager-preview-root")!).render(
  <StrictMode>
    <App initialScenes={previewScenes} />
  </StrictMode>,
);
