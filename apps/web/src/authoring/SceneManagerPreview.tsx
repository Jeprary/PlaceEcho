import type { Scene } from "@placeecho/shared";
import { useRef, useState } from "react";
import { NewMemoryFlow } from "./NewMemoryFlow";
import type {
  NewMemoryDraft,
  MemorySubmissionReceipt,
  NewMemoryRequest,
} from "./memorySubmission";
import { MemoryCollection } from "../memory/MemoryCollection";
import {
  buildMemoryItems,
  type MemoryItem,
  type MemoryOpenIntent,
} from "../memory/fixtures";
import type { PanoramaAsset } from "../world/panorama";

type View = "dashboard" | "create";
const saveUnavailableMessage = "暂时无法保存，请稍后重试。";

type MemoryManagerProps = {
  scenes: readonly Scene[];
  openingMemoryId?: string | null;
  onOpenMemory: (intent: MemoryOpenIntent) => void;
  onBeginCreate: () => Promise<{ sceneId: string }>;
  onCreateRequest: (request: NewMemoryRequest) => Promise<MemorySubmissionReceipt>;
  onCapturePanorama?: (sceneId: string) => void;
  captureState?: "idle" | "requesting" | "staged" | "ready" | "failed";
  capturedPanorama?: PanoramaAsset | null;
};

export function MemoryManager({
  scenes,
  onOpenMemory,
  openingMemoryId = null,
  onBeginCreate,
  onCreateRequest,
  onCapturePanorama,
  captureState = "idle",
  capturedPanorama = null,
}: MemoryManagerProps) {
  const [view, setView] = useState<View>("dashboard");
  const [memories, setMemories] = useState<MemoryItem[]>(() =>
    buildMemoryItems(scenes),
  );
  const [requestError, setRequestError] = useState<string | null>(null);
  const [draftSceneId, setDraftSceneId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRequest = useRef(false);
  const draftSceneRequest = useRef<Promise<string> | null>(null);

  function ensureDraftScene(): Promise<string> {
    if (draftSceneId) return Promise.resolve(draftSceneId);
    if (draftSceneRequest.current) return draftSceneRequest.current;
    const request = onBeginCreate()
      .then((draft) => {
        setDraftSceneId(draft.sceneId);
        setRequestError(null);
        return draft.sceneId;
      })
      .finally(() => {
        if (draftSceneRequest.current === request) {
          draftSceneRequest.current = null;
        }
      });
    draftSceneRequest.current = request;
    return request;
  }

  function beginCreate() {
    setView("create");
    setRequestError(null);
    if (draftSceneId) return;
    void ensureDraftScene().catch(() => undefined);
  }

  async function createMemory(draft: NewMemoryDraft) {
    if (submittingRequest.current) return;
    submittingRequest.current = true;
    setRequestError(null);
    setSubmitting(true);
    let receipt: MemorySubmissionReceipt;
    let assignedSceneId: string | null = null;
    try {
      assignedSceneId = await ensureDraftScene();
      receipt = await onCreateRequest({ ...draft, sceneId: assignedSceneId });
    } catch (error) {
      setRequestError(
        assignedSceneId && error instanceof Error
          ? error.message
          : saveUnavailableMessage,
      );
      submittingRequest.current = false;
      setSubmitting(false);
      return;
    }
    submittingRequest.current = false;
    setSubmitting(false);
    setMemories((current) => [{
      uiKey: receipt.requestId,
      sceneId: receipt.sceneId,
      memoryId: null,
      title: "新的回忆",
      summary: "正在整理你选择的内容",
      mediaCount: draft.media.length,
      status: "processing",
      canEnterSpace: false,
      coverUrl: null,
      fallbackCoverUrl: null,
      tone: "moss",
    }, ...current]);
    setDraftSceneId(null);
    setView("dashboard");
  }

  if (view === "create") {
    return (
      <NewMemoryFlow
        sceneId={draftSceneId}
        captureState={captureState}
        capturedPanorama={capturedPanorama}
        onCapturePanorama={
          onCapturePanorama && draftSceneId
            ? () => onCapturePanorama(draftSceneId)
            : undefined
        }
        captureWaitingForBackend={Boolean(
          onCapturePanorama && !draftSceneId,
        )}
        onCancel={() => setView("dashboard")}
        onCreate={createMemory}
        submitting={submitting}
        submissionError={requestError}
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
          <button type="button" onClick={beginCreate}><PlusIcon /> 创建新回忆</button>
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
