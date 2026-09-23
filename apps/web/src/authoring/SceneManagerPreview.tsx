import type { Scene } from "@placeecho/shared";
import { useRef, useState } from "react";
import { NewMemoryFlow, type NewMemoryRequest } from "./NewMemoryFlow";
import { MemoryCollection } from "../memory/MemoryCollection";
import {
  buildMemoryItems,
  type MemoryItem,
  type MemoryOpenIntent,
} from "../memory/fixtures";

type View = "dashboard" | "create";

export type MemoryRequestReceipt = {
  requestId: string;
  sceneId: string;
};

type MemoryManagerProps = {
  scenes: readonly Scene[];
  sceneCoverUrls?: Readonly<Record<string, string>>;
  openingMemoryId?: string | null;
  onOpenMemory: (intent: MemoryOpenIntent) => void;
  onBeginCreate: () => Promise<{ sceneId: string }>;
  onCreateRequest: (request: NewMemoryRequest) => Promise<MemoryRequestReceipt>;
  onCapturePanorama?: (sceneId: string) => void;
  captureState?: "idle" | "requesting" | "staged" | "ready" | "failed";
};

export function MemoryManager({
  scenes,
  sceneCoverUrls = {},
  onOpenMemory,
  openingMemoryId = null,
  onBeginCreate,
  onCreateRequest,
  onCapturePanorama,
  captureState = "idle",
}: MemoryManagerProps) {
  const [view, setView] = useState<View>("dashboard");
  const [memories, setMemories] = useState<MemoryItem[]>(() =>
    buildMemoryItems(scenes, sceneCoverUrls),
  );
  const [requestError, setRequestError] = useState<string | null>(null);
  const [draftSceneId, setDraftSceneId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const submittingRequest = useRef(false);

  async function beginCreate() {
    if (creatingDraft) return;
    if (draftSceneId) {
      setView("create");
      return;
    }
    setCreatingDraft(true);
    setRequestError(null);
    try {
      const draft = await onBeginCreate();
      setDraftSceneId(draft.sceneId);
      setView("create");
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "无法创建新的空间，请重试。",
      );
    } finally {
      setCreatingDraft(false);
    }
  }

  async function createMemory(request: NewMemoryRequest) {
    if (submittingRequest.current) return;
    submittingRequest.current = true;
    setRequestError(null);
    let receipt: MemoryRequestReceipt;
    try {
      receipt = await onCreateRequest(request);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "创建请求保存失败，请重试。",
      );
      submittingRequest.current = false;
      setView("dashboard");
      return;
    }
    submittingRequest.current = false;
    setMemories((current) => [{
      uiKey: receipt.requestId,
      sceneId: receipt.sceneId,
      memoryId: null,
      title: "新的回忆",
      summary: "正在整理你选择的内容",
      mediaCount: request.media.length,
      panoramaName: request.panoramaName,
      status: "processing",
      canEnterSpace: false,
      coverUrl: null,
      tone: "moss",
    }, ...current]);
    setDraftSceneId(null);
    setView("dashboard");
  }

  if (view === "create") {
    if (!draftSceneId) return null;
    return (
      <NewMemoryFlow
        sceneId={draftSceneId}
        captureState={captureState}
        onCapturePanorama={
          onCapturePanorama
            ? () => onCapturePanorama(draftSceneId)
            : undefined
        }
        onCancel={() => setView("dashboard")}
        onCreate={createMemory}
      />
    );
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
          <button type="button" disabled={creatingDraft} onClick={beginCreate}><PlusIcon /> {creatingDraft ? "正在准备…" : "创建新回忆"}</button>
        </div>

        {requestError && <p role="alert">{requestError}</p>}

        <MemoryCollection
          memories={memories}
          openingMemoryId={openingMemoryId}
          onOpenMemory={onOpenMemory}
        />
      </main>

    </div>
  );
}

function LogoMark() {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M6 20c5-8 13-12 24-10-3 11-10 17-20 16" /><path d="M9 26c5-5 10-8 17-11" /></svg>;
}
function PlusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
