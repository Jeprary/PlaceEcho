import type { Scene } from "@placeecho/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { HeroObject } from "../memory/HeroObject";
import {
  SpatialRuntime,
  type WorldLoadStatus,
} from "../world/SpatialRuntime";
import type {
  GroundingRenderView,
  ResolveWorldAnchorsResult,
} from "../world/groundingPipeline";
import "./grounding-verification.css";

type GroundingVerificationProps = {
  sceneId: string;
  apiBaseUrl?: string;
};

type RunState =
  | { type: "idle" }
  | { type: "running" }
  | { type: "completed"; result: ResolveWorldAnchorsResult }
  | { type: "failed"; message: string };

type HeroJobSnapshot = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  asset_url: string | null;
  error: string | null;
};

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function GroundingVerification({
  sceneId,
  apiBaseUrl = "",
}: GroundingVerificationProps) {
  const runtimeHost = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SpatialRuntime | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [worldStatus, setWorldStatus] = useState<WorldLoadStatus>("loading");
  const [run, setRun] = useState<RunState>({ type: "idle" });
  const [heroJob, setHeroJob] = useState<HeroJobSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    void fetch(
      endpoint(apiBaseUrl, `/api/scenes/${encodeURIComponent(sceneId)}`),
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`场景读取失败（${response.status}）`);
        }
        return (await response.json()) as Scene;
      })
      .then(setScene)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [apiBaseUrl, sceneId]);

  const targetMemory = useMemo(
    () => {
      if (!scene) return null;
      const recommendedId = scene.hero_recommendation?.memory_id;
      return scene.memories.find((memory) => memory.id === recommendedId) ??
        scene.memories.find((memory) => memory.anchor.position === null) ??
        scene.memories[0] ??
        null;
    },
    [scene],
  );

  useEffect(() => {
    const jobId = targetMemory?.anchor.hero.job_id;
    const status = targetMemory?.anchor.hero.status;
    if (!jobId || (status !== "queued" && status !== "running")) return;
    const controller = new AbortController();

    const poll = async () => {
      while (!controller.signal.aborted) {
        const response = await fetch(
          endpoint(apiBaseUrl, `/api/jobs/${encodeURIComponent(jobId)}`),
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Hero 任务读取失败（${response.status}）`);
        const job = (await response.json()) as HeroJobSnapshot;
        setHeroJob(job);
        if (job.status === "completed" || job.status === "failed") {
          const sceneResponse = await fetch(
            endpoint(apiBaseUrl, `/api/scenes/${encodeURIComponent(sceneId)}`),
            { signal: controller.signal },
          );
          if (!sceneResponse.ok) {
            throw new Error(`场景读取失败（${sceneResponse.status}）`);
          }
          setScene((await sceneResponse.json()) as Scene);
          return;
        }
        await delay(5_000, controller.signal);
      }
    };

    void poll().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setHeroJob({
        job_id: jobId,
        status: "failed",
        asset_url: null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [apiBaseUrl, sceneId, targetMemory?.anchor.hero.job_id, targetMemory?.anchor.hero.status]);

  useEffect(() => {
    if (!scene || !targetMemory || !runtimeHost.current) return;
    const runtime = new SpatialRuntime(runtimeHost.current, {
      scene,
      mode: "localization",
      targetMemoryId: targetMemory.id,
      onWorldStatus: setWorldStatus,
    });
    runtimeRef.current = runtime;
    runtime.start();
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, [scene, targetMemory]);

  const verify = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || run.type === "running") return;
    setRun({ type: "running" });
    try {
      const result = await runtime.prepareGrounding({
        sceneId,
        apiBaseUrl,
        heroGeneration: {
          provider: "aholo",
          version: "G1-Turbo",
          enable_pbr: true,
          ai_predict_size: true,
          confirm_external_processing: true,
        },
      });
      setScene(result.scene);
      setRun({ type: "completed", result });
    } catch (error) {
      setRun({
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (loadError) {
    return <main className="grounding-verification grounding-verification--message">{loadError}</main>;
  }
  if (!scene) {
    return <main className="grounding-verification grounding-verification--message">正在读取场景…</main>;
  }
  if (!targetMemory) {
    return (
      <main className="grounding-verification grounding-verification--message">
        这个场景没有等待定位的 Memory；请先完成 Memory AI，或清空一个 Anchor 再验收。
      </main>
    );
  }

  return (
    <main className="grounding-verification">
      <section className="grounding-verification__world">
        <div ref={runtimeHost} className="grounding-verification__runtime" />
        <div className="grounding-verification__legend">
          <span><i className="is-ray" /> 相机射线</span>
          <span><i className="is-surface" /> Collider 表面</span>
          <span><i className="is-anchor" /> 最终 Anchor</span>
          <span><i className="is-normal" /> 朝相机法线</span>
        </div>
      </section>

      <aside className="grounding-verification__panel">
        <p className="grounding-verification__eyebrow">Web Geometry 验收</p>
        <h1>{targetMemory.name}</h1>
        <p>
          AI 只选二维像素；浏览器用当前 Collider 反投，再沿朝相机法线前推后保存。
        </p>
        <dl>
          <div><dt>场景</dt><dd>{scene.scene_id}</dd></div>
          <div><dt>世界</dt><dd>{worldStatus}</dd></div>
          <div><dt>Memory</dt><dd>{targetMemory.id}</dd></div>
        </dl>
        <button
          type="button"
          disabled={worldStatus !== "ready" || run.type !== "idle"}
          onClick={verify}
        >
          {run.type === "running"
            ? "正在定位、反投并判断 Hero…"
            : targetMemory.anchor.position
              ? "重新运行定位与 Hero 验收"
              : "运行一次定位与 Hero 验收"}
        </button>
        {run.type === "failed" && <p role="alert">{run.message}</p>}
        {run.type === "completed" && (
          <GroundingResult result={run.result} memoryId={targetMemory.id} />
        )}
        <HeroResult
          apiBaseUrl={apiBaseUrl}
          hero={targetMemory.anchor.hero}
          job={heroJob}
        />
      </aside>
    </main>
  );
}

function HeroResult({
  apiBaseUrl,
  hero,
  job,
}: {
  apiBaseUrl: string;
  hero: Scene["memories"][number]["anchor"]["hero"];
  job: HeroJobSnapshot | null;
}) {
  if (hero.status === "not_requested") return null;
  if (hero.status === "queued" || hero.status === "running") {
    return (
      <section className="grounding-verification__hero-status" aria-live="polite">
        <h2>Hero 正在生成</h2>
        <p>{job?.status === "running" ? "模型正在重建三维物体…" : "任务已进入队列…"}</p>
      </section>
    );
  }
  if (hero.status === "failed") {
    return (
      <section className="grounding-verification__hero-status" role="alert">
        <h2>Hero 未生成</h2>
        <p>{job?.error ?? "生成服务没有返回可用模型。"}</p>
      </section>
    );
  }
  if (!hero.asset_url) return null;
  return (
    <section className="grounding-verification__hero-result">
      <h2>Hero 已生成并保存</h2>
      <HeroObject assetUrl={resolveAssetUrl(apiBaseUrl, hero.asset_url)} />
    </section>
  );
}

function resolveAssetUrl(baseUrl: string, value: string): string {
  return /^https:\/\//.test(value) ? value : endpoint(baseUrl, value);
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function GroundingResult({
  result,
  memoryId,
}: {
  result: ResolveWorldAnchorsResult;
  memoryId: string;
}) {
  const memory = result.scene.memories.find((item) => item.id === memoryId);
  const grounding = memory?.anchor.world_grounding;
  const resolution = result.anchors.find((item) => item.memory_id === memoryId);
  const view = grounding
    ? result.views.find((item) => item.view_id === grounding.view_id)
    : undefined;
  return (
    <section className="grounding-verification__result">
      <h2>{resolution?.status === "persisted" ? "已命中并保存" : "未完成"}</h2>
      {view && grounding && <GroundingImage view={view} x={grounding.x} y={grounding.y} />}
      {resolution?.hit && (
        <dl>
          <div><dt>表面点</dt><dd>{resolution.hit.surface_position.map(format).join(", ")}</dd></div>
          <div><dt>最终点</dt><dd>{resolution.hit.position.map(format).join(", ")}</dd></div>
          <div><dt>法线</dt><dd>{resolution.hit.normal?.map(format).join(", ") ?? "不可用"}</dd></div>
          <div><dt>前推</dt><dd>{format(resolution.hit.offset_meters)} m</dd></div>
        </dl>
      )}
      {result.heroGenerationError && (
        <p role="alert">定位已保存，但 Hero 未启动：{result.heroGenerationError}</p>
      )}
    </section>
  );
}

function GroundingImage({
  view,
  x,
  y,
}: {
  view: GroundingRenderView;
  x: number;
  y: number;
}) {
  return (
    <figure className="grounding-verification__capture">
      <img src={view.image_data_url} alt="AI 使用的最终世界视图" />
      <span
        aria-label={`AI 像素 ${Math.round(x)}, ${Math.round(y)}`}
        style={{
          left: `${((x + 0.5) / view.width) * 100}%`,
          top: `${((y + 0.5) / view.height) * 100}%`,
        }}
      />
      <figcaption>AI 像素：{Math.round(x)}, {Math.round(y)} · {view.view_id}</figcaption>
    </figure>
  );
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}
