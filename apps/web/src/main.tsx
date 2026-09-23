import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Scene } from "@placeecho/shared";
import previewConfigFixture from "../../../assets/demo/scene-manager-preview.json";
import { App } from "./App";
import "./styles.css";

type LocalPreviewConfig = {
  scenes: Scene[];
};

const previewConfig = previewConfigFixture as unknown as LocalPreviewConfig;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initialScenes={previewConfig.scenes} />
  </StrictMode>,
);
