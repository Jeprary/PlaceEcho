import type { IOSBridgeStatus } from "./world/IOSPanoramaBridge";

export type IOSCaptureStatus =
  | { type: "idle" }
  | { type: "requesting" }
  | IOSBridgeStatus;

export interface WorldEntryMemory {
  id: string;
  sceneId: string;
  name: string;
  summary: string;
}

export interface WorldEntryProps {
  memories: WorldEntryMemory[];
  captureStatus: IOSCaptureStatus;
  openingMemoryId?: string | null;
  onOpenScene: (sceneId: string) => void;
  onCreateMemory: (sceneId?: string) => void;
}

export function WorldEntry({
  memories,
  captureStatus,
  openingMemoryId = null,
  onOpenScene,
  onCreateMemory,
}: WorldEntryProps) {
  const captureCopy = getCaptureCopy(captureStatus);

  return (
    <section className="world-entry" aria-labelledby="world-entry-title">
      <header className="world-entry__header">
        <p>PlaceEcho</p>
        <h1 id="world-entry-title">你的记忆空间</h1>
        <span>全部回忆</span>
      </header>

      <div className="world-entry__grid">
        {memories.map((memory) => (
          <article className="space-card space-card--existing" key={memory.id}>
            <p>已准备</p>
            <h2>{memory.name}</h2>
            <span>{memory.summary}</span>
            <button
              type="button"
              onClick={() => onOpenScene(memory.sceneId)}
              disabled={openingMemoryId === memory.id}
              aria-busy={openingMemoryId === memory.id}
            >
              {openingMemoryId === memory.id ? "正在进入…" : "进入回忆"}
            </button>
          </article>
        ))}

        <article
          className={`space-card space-card--capture space-card--${captureStatus.type}`}
          aria-live="polite"
        >
          <p>创建新回忆 · Insta360 X5</p>
          <h2>{captureCopy.title}</h2>
          <span>{captureCopy.detail}</span>
          <button
            type="button"
            onClick={() => onCreateMemory()}
            disabled={captureStatus.type === "requesting"}
            aria-busy={captureStatus.type === "requesting"}
          >
            {captureCopy.buttonLabel}
          </button>
        </article>
      </div>
    </section>
  );
}

function getCaptureCopy(
  status: IOSCaptureStatus,
): { title: string; detail: string; buttonLabel: string } {
  switch (status.type) {
    case "requesting":
      return {
        title: "正在通过 X5 拍摄",
        detail: "请保持 PlaceEcho 打开，并保持连接相机 Wi-Fi。",
        buttonLabel: "正在拍摄…",
      };
    case "staged":
      return {
        title: "照片已保存在这台 iPhone",
        detail:
          "请重新连接普通 Wi-Fi。上传尚未接通，因此全景图还没有正式导入。",
        buttonLabel: "再次拍摄",
      };
    case "ready":
      if (status.availability === "device") {
        return {
          title: "全景图已导入这台 iPhone",
          detail: "可以继续创建回忆；恢复正常网络后，PlaceEcho 会再同步到云端。",
          buttonLabel: "继续创建",
        };
      }
      return {
        title: "全景图已导入",
        detail: "这段全景素材已经进入 PlaceEcho，并完成云端同步。",
        buttonLabel: "继续创建",
      };
    case "failed":
      return {
        title: "拍摄需要处理",
        detail: status.message,
        buttonLabel: "重新尝试",
      };
    default:
      return {
        title: "创建一段新回忆",
        detail:
          "先在系统设置中将这台 iPhone 连接到 X5 Wi-Fi，回到 PlaceEcho 后开始拍摄。",
        buttonLabel: "使用 X5 拍摄",
      };
  }
}
