import { useRef, useState } from "react";
import { NewMemoryFlow, type NewMemoryRequest } from "./NewMemoryFlow";
import { MemoryCollection } from "../memory/MemoryCollection";
import { initialMemories, previewScene, type MemoryItem, type MemoryOpenIntent } from "../memory/fixtures";

type View = "dashboard" | "create";

type SceneManagerPreviewProps = {
  onOpenMemory?: (intent: MemoryOpenIntent) => void;
};

export function SceneManagerPreview({ onOpenMemory = dispatchOpenMemoryIntent }: SceneManagerPreviewProps) {
  const [view, setView] = useState<View>("dashboard");
  const [memories, setMemories] = useState<MemoryItem[]>(initialMemories);
  const pendingRequestSequence = useRef(0);

  function createMemory(request: NewMemoryRequest) {
    pendingRequestSequence.current += 1;
    setMemories((current) => [{
      uiKey: `pending-request-${pendingRequestSequence.current}`,
      sceneId: request.sceneId,
      memoryId: null,
      title: "新的回忆",
      summary: "正在整理你选择的内容",
      mediaCount: request.media.length,
      panoramaName: request.panoramaName,
      status: "processing",
      canEnterSpace: false,
      tone: "moss",
    }, ...current]);
    setView("dashboard");
  }

  if (view === "create") {
    return <NewMemoryFlow sceneId={previewScene.scene_id} onCancel={() => setView("dashboard")} onCreate={createMemory} />;
  }

  return (
    <div className="project-app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setView("dashboard")} aria-label="返回记忆空间首页">
          <LogoMark />
          <span><strong>PlaceEcho</strong></span>
        </button>
      </header>

      <main className="dashboard-shell">
        <header className="dashboard-heading">
          <div>
            <h1>你的记忆空间</h1>
            <p>查看已有回忆，或创建一段新的回忆</p>
          </div>
        </header>

        <div className="list-heading">
          <div><h2>全部回忆</h2></div>
          <button type="button" onClick={() => setView("create")}><PlusIcon /> 创建新回忆</button>
        </div>

        <MemoryCollection
          memories={memories}
          onOpenMemory={onOpenMemory}
        />
      </main>

    </div>
  );
}

function dispatchOpenMemoryIntent(intent: MemoryOpenIntent) {
  window.dispatchEvent(new CustomEvent<MemoryOpenIntent>("placeecho:open-memory", { detail: intent }));
}

function LogoMark() {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M6 20c5-8 13-12 24-10-3 11-10 17-20 16" /><path d="M9 26c5-5 10-8 17-11" /></svg>;
}
function PlusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
