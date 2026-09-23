import { useEffect, useRef, useState } from "react";

type Slide = { kind: "image" | "video"; src: string; poster?: string };
type MemoryManifest = {
  memories: Array<{ id: string; name: string; media: Slide[] }>;
};

type MemorySlidesOverlayProps = {
  active: boolean;
  memoryName: string;
  onFinished: () => void;
};

export function MemorySlidesOverlay({
  active,
  memoryName,
  onFinished,
}: MemorySlidesOverlayProps) {
  const [manifest, setManifest] = useState<MemoryManifest | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectedMemory =
    manifest?.memories.find((memory) => memory.name === memoryName) ??
    manifest?.memories[0];
  const slides = selectedMemory?.media ?? [];
  const slide = slides[index];

  useEffect(() => {
    let cancelled = false;
    void fetch("/memory/memory.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Memory manifest failed: ${response.status}`);
        }
        return response.json() as Promise<MemoryManifest>;
      })
      .then((nextManifest) => {
        if (!cancelled) setManifest(nextManifest);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn("PlaceEcho memory manifest could not be loaded.", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    setIndex(0);
    setPaused(false);
  }, [active, memoryName]);

  const advance = () => {
    if (index >= slides.length - 1) {
      onFinished();
      return;
    }
    setIndex((value) => value + 1);
  };

  useEffect(() => {
    if (!active || !slide || paused || slide.kind !== "image") return;
    const timer = window.setTimeout(advance, 1_800);
    return () => window.clearTimeout(timer);
  }, [active, index, paused, slide?.kind, slides.length]);

  useEffect(() => {
    if (!active || slide?.kind !== "video") return;
    const video = videoRef.current;
    if (video) void video.play().catch(() => setPaused(true));
  }, [active, index, slide?.kind]);

  if (!active || !slide) return null;

  return (
    <div className="memory-overlay" role="dialog" aria-label="Memory reveal">
      <div className="memory-card">
        {slide.kind === "image" ? (
          <img src={slide.src} alt="Memory" />
        ) : (
          <video
            ref={videoRef}
            src={slide.src}
            poster={slide.poster}
            playsInline
            controls={false}
            onEnded={advance}
          />
        )}
        {slide.kind === "video" && (
          <button
            className="memory-video-badge"
            type="button"
            aria-label="Play memory video"
            onClick={() => {
              setPaused(false);
              const video = videoRef.current;
              if (video) {
                video.muted = false;
                void video.play();
              }
            }}
          >
            ▶
          </button>
        )}
      </div>
      <div className="memory-progress" aria-label="Memory progress">
        {slides.map((_, slideIndex) => (
          <span
            className={slideIndex === index ? "active" : ""}
            key={slideIndex}
          />
        ))}
      </div>
      <button className="memory-close" type="button" onClick={onFinished}>
        Skip
      </button>
    </div>
  );
}
