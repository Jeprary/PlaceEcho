import { useCallback, useEffect, useRef, useState } from "react";

type Slide = {
  kind: "image" | "video";
  src: string;
  poster?: string;
  duration_ms?: number;
};
type MemoryManifest = {
  default_image_duration_ms?: number;
  memories: Array<{ id: string; media: Slide[] }>;
};

type MemorySlidesOverlayProps = {
  active: boolean;
  memoryId: string;
  onFinished: () => void;
};

const DEFAULT_IMAGE_DURATION_MS = 1_800;
const MIN_IMAGE_DURATION_MS = 250;

export function MemorySlidesOverlay({
  active,
  memoryId,
  onFinished,
}: MemorySlidesOverlayProps) {
  const [manifest, setManifest] = useState<MemoryManifest | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const unavailableHandled = useRef(false);
  const selectedMemory = manifest?.memories.find(
    (memory) => memory.id === memoryId,
  );
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
          setLoadFailed(true);
          console.warn("PlaceEcho memory manifest could not be loaded.", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    unavailableHandled.current = false;
    if (!active) return;
    setIndex(0);
    setPaused(false);
  }, [active, memoryId]);

  useEffect(() => {
    if (!active || unavailableHandled.current) return;
    const manifestReadyWithoutSlides = manifest !== null && slides.length === 0;
    if (!loadFailed && !manifestReadyWithoutSlides) return;
    unavailableHandled.current = true;
    onFinished();
  }, [active, loadFailed, manifest, onFinished, slides.length]);

  const advance = useCallback(() => {
    if (index >= slides.length - 1) {
      onFinished();
      return;
    }
    setIndex((value) => value + 1);
  }, [index, onFinished, slides.length]);

  useEffect(() => {
    if (!active || !slide || paused || slide.kind !== "image") return;
    const durationMs = Math.max(
      slide.duration_ms ??
        manifest?.default_image_duration_ms ??
        DEFAULT_IMAGE_DURATION_MS,
      MIN_IMAGE_DURATION_MS,
    );
    const timer = window.setTimeout(advance, durationMs);
    return () => window.clearTimeout(timer);
  }, [active, advance, manifest?.default_image_duration_ms, paused, slide]);

  useEffect(() => {
    if (!active || slide?.kind !== "video") return;
    const video = videoRef.current;
    if (video) void video.play().catch(() => setPaused(true));
  }, [active, index, slide?.kind]);

  if (!active || !slide) return null;

  return (
    <div
      className="memory-overlay"
      role="dialog"
      aria-label="Memory reveal"
      aria-modal="true"
    >
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
