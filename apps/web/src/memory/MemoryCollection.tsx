import type { MemoryItem } from "./fixtures";

type MemoryCollectionProps = {
  memories: MemoryItem[];
  onOpen: (memory: MemoryItem) => void;
};

export function MemoryCollection({ memories, onOpen }: MemoryCollectionProps) {
  return (
    <div className="memory-grid">
      {memories.map((memory) => (
        <article className={`memory-card tone-${memory.tone}`} key={memory.id}>
          <button type="button" className="memory-card-hit" onClick={() => onOpen(memory)} aria-label={`打开 ${memory.title}`} />
          <div className="memory-cover" aria-hidden="true">
            <div className="panorama-lines"><i /><i /><i /></div>
            <span>{memory.panoramaName}</span>
          </div>
          <div className="memory-card-body">
            {memory.status === "waiting-ai" && <StatusPill />}
            <h3>{memory.title}</h3>
            <p>{memory.summary}</p>
            <span className="open-memory-link">查看回忆 <ArrowIcon /></span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function MemoryDetail({ memory, onBack }: { memory: MemoryItem; onBack: () => void }) {
  return (
    <div className="detail-app">
      <header className="detail-topbar">
        <button className="back-link" type="button" onClick={onBack}><ArrowLeftIcon /> 返回你的记忆空间</button>
      </header>
      <main className="detail-shell">
        <header className="detail-heading">
          <div>{memory.status === "waiting-ai" && <StatusPill />}<h1>{memory.title}</h1><p>{memory.mediaCount} 项相关媒体</p></div>
          <button className="secondary-button" type="button" onClick={onBack}>完成</button>
        </header>
        <div className={`detail-panorama tone-${memory.tone}`}>
          <div className="detail-panorama-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          <span><PanoramaIcon /> {memory.panoramaName}</span>
        </div>
        <div className="detail-layout detail-layout-simple">
          <article className="detail-story">
            <p className="section-kicker">回忆内容</p>
            <h2>{memory.status === "waiting-ai" ? "正在生成回忆内容" : memory.summary}</h2>
            {memory.status === "waiting-ai" ? (
              <div className="waiting-message"><SpinnerIcon /><div><strong>正在生成</strong><p>正在整理你选择的内容，完成后会显示回忆名称和内容。</p></div></div>
            ) : (
              <p className="reflection-copy">{memory.reflection ?? "还没有补充个人感想。"}</p>
            )}
          </article>
        </div>
      </main>
    </div>
  );
}

function StatusPill() {
  return <span className="status-pill waiting"><SpinnerIcon /> 生成中</span>;
}

function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6M5 12h10" /></svg>; }
function ArrowLeftIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h10" /></svg>; }
function PanoramaIcon() { return <svg viewBox="0 0 40 22" aria-hidden="true"><path d="M3 5c10-3 24-3 34 0v12c-10-3-24-3-34 0V5Z" /><path d="m5 15 8-6 6 4 5-3 11 5" /><circle cx="29.5" cy="8" r="1.5" /></svg>; }
function SpinnerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-8.5 6" /></svg>; }
