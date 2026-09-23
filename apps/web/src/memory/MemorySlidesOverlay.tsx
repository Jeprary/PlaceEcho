import { useCallback, useEffect, useRef, useState } from "react";

type Slide = {
  kind: "image" | "video";
  src: string;
  poster?: string;
  ambient_src?: string;
  duration_ms?: number;
};
type MemoryManifest = {
  default_image_duration_ms?: number;
  memories: Array<{ id: string; media: Slide[] }>;
};

type MemorySlidesOverlayProps = {
  active: boolean;
  memoryId: string;
  heroLayout?: boolean;
  audibleAutoplay?: boolean;
  preloadEnabled?: boolean;
  onFinished: () => void;
};

const DEFAULT_IMAGE_DURATION_MS = 1_800;
const MIN_IMAGE_DURATION_MS = 250;

export function MemorySlidesOverlay({
  active,
  memoryId,
  heroLayout = false,
  audibleAutoplay = false,
  preloadEnabled = true,
  onFinished,
}: MemorySlidesOverlayProps) {
  const [manifest, setManifest] = useState<MemoryManifest | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [previousSlide, setPreviousSlide] = useState<Slide | null>(null);
  const [paused, setPaused] = useState(false);
  const [videoMuted, setVideoMuted] = useState(!audibleAutoplay);
  const [videoBuffering, setVideoBuffering] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ambientVideoRef = useRef<HTMLVideoElement>(null);
  const unavailableHandled = useRef(false);
  const selectedMemory = manifest?.memories.find(
    (memory) => memory.id === memoryId,
  );
  const slides = selectedMemory?.media ?? [];
  const slide = slides[index];
  const preparedVideo = slides.find((item) => item.kind === "video");

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
    if (!manifest || !preloadEnabled) return;
    const retainedMedia: Array<HTMLImageElement | HTMLVideoElement> = [];
    const imageSources = new Set<string>();

    manifest.memories.forEach((memory) => {
      memory.media.forEach((media) => {
        if (media.kind === "image") imageSources.add(media.src);
        if (media.poster) imageSources.add(media.poster);

        const preloadVideo = (src: string) => {
          const video = document.createElement("video");
          video.preload = "auto";
          video.muted = true;
          video.playsInline = true;
          video.src = src;
          video.load();
          retainedMedia.push(video);
        };
        if (media.kind === "video") preloadVideo(media.src);
        if (media.ambient_src) preloadVideo(media.ambient_src);
      });
    });

    imageSources.forEach((src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      void image.decode().catch(() => undefined);
      retainedMedia.push(image);
    });

    return () => {
      retainedMedia.forEach((media) => {
        if (media instanceof HTMLVideoElement) {
          media.removeAttribute("src");
          media.load();
        }
      });
    };
  }, [manifest, preloadEnabled]);

  useEffect(() => {
    unavailableHandled.current = false;
    if (!active) return;
    setIndex(0);
    setPreviousSlide(null);
    setPaused(false);
    setVideoMuted(!audibleAutoplay);
    setVideoBuffering(true);
  }, [active, audibleAutoplay, memoryId]);

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
    setPreviousSlide(slide ?? null);
    setIndex((value) => value + 1);
  }, [index, onFinished, slide, slides.length]);

  useEffect(() => {
    if (!previousSlide) return;
    const timer = window.setTimeout(() => setPreviousSlide(null), 620);
    return () => window.clearTimeout(timer);
  }, [previousSlide]);

  const syncAmbientVideo = useCallback((force = false) => {
    const video = videoRef.current;
    const ambient = ambientVideoRef.current;
    if (!video || !ambient) return;
    if (force || Math.abs(ambient.currentTime - video.currentTime) > 0.12) {
      ambient.currentTime = video.currentTime;
    }
    ambient.playbackRate = video.playbackRate;
    if (video.paused) {
      ambient.pause();
      return;
    }
    void ambient.play().catch(() => undefined);
  }, []);

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
    if (video) {
      void video
        .play()
        .then(() => {
          setPaused(false);
          syncAmbientVideo(true);
        })
        .catch(() => {
          if (!video.muted) {
            video.muted = true;
            setVideoMuted(true);
            void video
              .play()
              .then(() => {
                setPaused(false);
                syncAmbientVideo(true);
              })
              .catch(() => setPaused(true));
            return;
          }
          setPaused(true);
        });
    }
  }, [active, index, slide?.kind, syncAmbientVideo]);

  if (!active || !slide) return null;

  const renderAmbient = (item: Slide) => {
    if (item.kind === "image") {
      return <img src={item.src} alt="" decoding="async" />;
    }
    return item.poster ? (
      <img src={item.poster} alt="" decoding="async" />
    ) : null;
  };

  return (
    <div
      className={`memory-overlay${
        heroLayout ? " memory-overlay--with-hero" : ""
      }${slide.kind === "video" ? " memory-overlay--video" : ""}`}
      role="dialog"
      aria-label="Memory reveal"
      aria-modal="true"
    >
      {previousSlide && (
        <div
          key={`ambient-previous-${previousSlide.src}`}
          className="memory-ambient memory-ambient--previous"
          aria-hidden="true"
        >
          {renderAmbient(previousSlide)}
        </div>
      )}
      {preparedVideo?.ambient_src && (
        <div
          className={`memory-ambient memory-ambient--prepared-video${
            slide.kind === "video" ? " is-active" : ""
          }`}
          aria-hidden="true"
        >
          <video
            ref={ambientVideoRef}
            className="memory-ambient-video memory-ambient-video--prepared"
            src={preparedVideo.ambient_src}
            poster={preparedVideo.poster}
            preload="auto"
            muted
            playsInline
            tabIndex={-1}
          />
        </div>
      )}
      {(slide.kind !== "video" || !slide.ambient_src) && (
        <div
          key={`ambient-current-${slide.src}`}
          className="memory-ambient memory-ambient--current"
          aria-hidden="true"
        >
          {renderAmbient(slide)}
        </div>
      )}
      <div
        className={`memory-card memory-card--${slide.kind}`}
      >
        {previousSlide && (
          <div
            key={`previous-${previousSlide.src}`}
            className="memory-media memory-media--previous memory-image-frame"
            aria-hidden="true"
          >
            {(previousSlide.kind === "image" || previousSlide.poster) && (
              <img
                className="memory-image"
                src={
                  previousSlide.kind === "image"
                    ? previousSlide.src
                    : previousSlide.poster
                }
                alt=""
                decoding="async"
              />
            )}
          </div>
        )}
        {slide.kind === "image" && (
          <div
            key={slide.src}
            className="memory-media memory-media--current memory-image-frame"
          >
            <img
              className="memory-image"
              src={slide.src}
              alt="Memory"
              decoding="async"
            />
          </div>
        )}
        {preparedVideo && (
          <div
            className={`memory-media memory-video-frame memory-video-frame--prepared${
              slide.kind === "video" ? " is-active" : ""
            }`}
            aria-hidden={slide.kind !== "video"}
          >
            <video
              ref={videoRef}
              className="memory-video"
              src={preparedVideo.src}
              poster={preparedVideo.poster}
              preload="auto"
              muted={videoMuted}
              playsInline
              controls={false}
              onLoadStart={() => setVideoBuffering(true)}
              onLoadedData={() => setVideoBuffering(false)}
              onCanPlay={() => setVideoBuffering(false)}
              onPlaying={() => setVideoBuffering(false)}
              onWaiting={() => setVideoBuffering(true)}
              onStalled={() => setVideoBuffering(true)}
              onPlay={() => syncAmbientVideo(true)}
              onPause={() => ambientVideoRef.current?.pause()}
              onSeeking={() => syncAmbientVideo(true)}
              onTimeUpdate={() => syncAmbientVideo(false)}
              onRateChange={() => syncAmbientVideo(true)}
              onEnded={() => {
                ambientVideoRef.current?.pause();
                advance();
              }}
            />
            {preparedVideo.poster && (
              <img
                className={`memory-video-poster${
                  videoBuffering ? " is-visible" : ""
                }`}
                src={preparedVideo.poster}
                alt=""
                aria-hidden="true"
                decoding="async"
              />
            )}
          </div>
        )}
        {slide.kind === "video" && (paused || videoMuted) && (
          <button
            className="memory-video-badge"
            type="button"
            aria-label={paused ? "Play memory video" : "Enable memory audio"}
            onClick={() => {
              setPaused(false);
              setVideoMuted(false);
              const video = videoRef.current;
              if (video) {
                video.muted = false;
                void video.play();
              }
            }}
          >
            {paused ? "▶" : "♪"}
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
