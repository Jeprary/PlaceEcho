import { useEffect, useRef, useState } from "react";

type Slide = { kind: "image" | "video"; src: string; poster?: string };
type MemoryManifest = { memories: Array<{ id: string; name: string; media: Slide[] }> };

export function MemorySlidesOverlay({ active, memoryName, onFinished }: { active: boolean; memoryName: string; onFinished: () => void }) {
  const [manifest, setManifest] = useState<MemoryManifest | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectedMemory = manifest?.memories.find(memory => memory.name === memoryName) ?? manifest?.memories[0];
  const slides = selectedMemory?.media ?? [];
  const slide = slides[index];
  useEffect(() => { void fetch("/memory/memory.json").then(response => response.json() as Promise<MemoryManifest>).then(setManifest); }, []);
  useEffect(() => { if (active) { setIndex(0); setPaused(false); } }, [active, memoryName]);
  useEffect(() => {
    if (!active || !slide || paused || slide.kind !== "image") return;
    const timer = window.setTimeout(() => next(), 1800);
    return () => window.clearTimeout(timer);
  }, [active, paused, index, slide?.kind]);
  useEffect(() => { if (active && slide?.kind === "video") { const video = videoRef.current; if (video) void video.play().catch(() => setPaused(true)); } }, [active, index, slide?.kind]);
  if (!active || !slide) return null;
  function next() { if (index >= slides.length - 1) onFinished(); else setIndex(value => value + 1); }
  return <div className="memory-overlay" role="dialog" aria-label="Memory reveal">
    <div className="memory-card">
      {slide.kind === "image" ? <img src={slide.src} alt="Memory" /> : <video ref={videoRef} src={slide.src} poster={slide.poster} playsInline controls={false} onEnded={next} />}
      {slide.kind === "video" && <button className="memory-video-badge" onClick={() => { setPaused(false); const video = videoRef.current; if (video) { video.muted = false; void video.play(); } }}>V</button>}
    </div>
    <div className="memory-progress">{slides.map((_, i) => <span className={i === index ? "active" : ""} key={i} />)}</div>
    <button className="memory-close" onClick={onFinished}>跳过</button>
  </div>;
}
