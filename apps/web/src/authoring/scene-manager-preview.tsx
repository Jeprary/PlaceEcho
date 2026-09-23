import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SceneManagerPreview } from "./SceneManagerPreview";
import "./scene-manager-preview.css";

createRoot(document.getElementById("scene-manager-preview-root")!).render(
  <StrictMode>
    <SceneManagerPreview />
  </StrictMode>,
);
