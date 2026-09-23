import { useState } from "react";
import { NewMemoryFlow } from "./NewMemoryFlow";
import { MemoryCollection, MemoryDetail } from "../memory/MemoryCollection";
import { initialMemories, type MemoryItem } from "../memory/fixtures";

type View = "dashboard" | "create" | "detail";

export function SceneManagerPreview() {
  const [view, setView] = useState<View>("dashboard");
  const [memories, setMemories] = useState<MemoryItem[]>(initialMemories);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);

  function openMemory(memory: MemoryItem) {
    setSelectedMemory(memory);
    setView("detail");
  }

  function createMemory(memory: MemoryItem) {
    setMemories((current) => [memory, ...current]);
    setView("dashboard");
  }

  if (view === "create") {
    return <NewMemoryFlow onCancel={() => setView("dashboard")} onCreate={createMemory} />;
  }

  if (view === "detail" && selectedMemory) {
    return <MemoryDetail memory={selectedMemory} onBack={() => setView("dashboard")} />;
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
          onOpen={openMemory}
        />
      </main>

    </div>
  );
}

function LogoMark() {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M6 20c5-8 13-12 24-10-3 11-10 17-20 16" /><path d="M9 26c5-5 10-8 17-11" /></svg>;
}
function PlusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
