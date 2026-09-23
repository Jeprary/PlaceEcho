import type { MemoryItem, MemoryOpenIntent } from "./fixtures";

type MemoryCollectionProps = {
  memories: MemoryItem[];
  openingMemoryId?: string | null;
  onOpenMemory: (intent: MemoryOpenIntent) => void;
};

export function MemoryCollection({
  memories,
  openingMemoryId = null,
  onOpenMemory,
}: MemoryCollectionProps) {
  return (
    <div className="scene-manager-memory-grid">
      {memories.map((memory) => (
        <article className={`scene-manager-memory-card tone-${memory.tone}${memory.canEnterSpace ? " is-ready" : ""}`} key={memory.uiKey}>
          <button
            type="button"
            className="scene-manager-memory-card-hit"
            onClick={() => memory.memoryId && onOpenMemory({ sceneId: memory.sceneId, memoryId: memory.memoryId })}
            aria-label={memory.canEnterSpace ? `进入空间查看${memory.title}` : `${memory.title}正在处理`}
            disabled={
              !memory.canEnterSpace ||
              !memory.memoryId ||
              openingMemoryId === memory.memoryId
            }
          />
          <div className="scene-manager-memory-cover" aria-hidden="true">
            {memory.coverUrl ? (
              <img src={memory.coverUrl} alt="" decoding="async" />
            ) : (
              <div className="scene-manager-panorama-lines"><i /><i /><i /></div>
            )}
          </div>
          <div className="scene-manager-memory-card-body">
            {memory.status === "processing" && <StatusPill />}
            <h3>{memory.title}</h3>
            <p>{memory.summary}</p>
            <span className={`scene-manager-open-memory-link${memory.canEnterSpace ? "" : " disabled"}`}>
              {openingMemoryId === memory.memoryId
                ? "正在进入…"
                : memory.canEnterSpace
                  ? "进入空间"
                  : "正在处理"}
              {memory.canEnterSpace && <ArrowIcon />}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatusPill() {
  return <span className="scene-manager-status-pill"><SpinnerIcon /> 正在处理</span>;
}

function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6M5 12h10" /></svg>; }
function SpinnerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-8.5 6" /></svg>; }
