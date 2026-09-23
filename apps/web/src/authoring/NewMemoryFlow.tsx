import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  NewMemoryRequest,
  SelectedMemoryMedia,
} from "./memorySubmission";

type NewMemoryFlowProps = {
  sceneId: string;
  captureState?: "idle" | "requesting" | "staged" | "ready" | "failed";
  onCapturePanorama?: () => void;
  onCancel: () => void;
  onCreate: (request: NewMemoryRequest) => void;
  submitting?: boolean;
  submissionError?: string | null;
};

type SelectedMedia = SelectedMemoryMedia & {
  clientKey: string;
};

const demoMedia: SelectedMedia[] = [
  { clientKey: "demo-1", name: "窗边合影.jpg", kind: "照片", size: "2.4 MB", file: null },
  { clientKey: "demo-2", name: "夏日晚餐.mov", kind: "视频", size: "18.7 MB", file: null },
  { clientKey: "demo-3", name: "阳台植物.jpg", kind: "照片", size: "3.1 MB", file: null },
  { clientKey: "demo-4", name: "雨声.m4a", kind: "声音", size: "1.8 MB", file: null },
  { clientKey: "demo-5", name: "搬家第一天.jpg", kind: "照片", size: "2.8 MB", file: null },
  { clientKey: "demo-6", name: "深夜厨房.jpg", kind: "照片", size: "2.2 MB", file: null },
];

export function NewMemoryFlow({
  sceneId,
  captureState = "idle",
  onCapturePanorama,
  onCancel,
  onCreate,
  submitting = false,
  submissionError = null,
}: NewMemoryFlowProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [panoramaName, setPanoramaName] = useState<string | null>(null);
  const [panoramaFile, setPanoramaFile] = useState<File | null>(null);
  const [contextText, setContextText] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "requesting" | "recording" | "saving" | "recorded" | "error">("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [waveform, setWaveform] = useState(() => Array.from({ length: 27 }, (_, index) => 7 + (index % 4) * 2));
  const [media, setMedia] = useState<SelectedMedia[]>([]);
  const panoramaInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const mediaClientKeySequence = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedAudioRef = useRef<Blob | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => releaseAudioResources(), []);
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (captureState === "ready" && step === 0) {
      completePanorama("Insta360 X5 空间全景.jpg");
    }
  }, [captureState, step]);

  function choosePanorama(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) completePanorama(file.name, file);
    event.target.value = "";
  }

  function completePanorama(name: string, file: File | null = null) {
    setPanoramaName(name);
    setPanoramaFile(file);
    setStep(1);
  }

  function goToPreviousStep() {
    setStep((current) => (current === 2 ? 1 : 0));
  }

  function chooseMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const selectedFiles = files.map((file): SelectedMedia => {
      mediaClientKeySequence.current += 1;
      return {
        clientKey: `selected-media-${mediaClientKeySequence.current}`,
        name: file.name || "未命名文件",
        kind: file.type.startsWith("video") ? "视频" : file.type.startsWith("audio") ? "声音" : "照片",
        size: formatFileSize(file.size),
        file,
      };
    });
    setMedia((current) => [...current, ...selectedFiles]);
    event.target.value = "";
  }

  function createMemory() {
    releaseAudioResources();
    onCreate({
      sceneId,
      panorama: {
        name: panoramaName ?? "演示空间全景.jpg",
        file: panoramaFile,
      },
      media: media.map(({ name, kind, size, file }) => ({
        name,
        kind,
        size,
        file,
      })),
      voiceRecording: recordedAudioRef.current,
      contextText: contextText.trim() || null,
    });
  }

  async function startRecording() {
    releaseAudioResources();
    recordedAudioRef.current = null;
    setVoiceState("requesting");
    setRecordingSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      recordedChunksRef.current = [];

      if (typeof MediaRecorder !== "undefined") {
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) recordedChunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          recordedAudioRef.current = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          setVoiceState("recorded");
        };
        recorder.start();
        recorderRef.current = recorder;
      }

      const samples = new Uint8Array(analyser.fftSize);
      recordingStartedAtRef.current = performance.now();
      setVoiceState("recording");

      const drawWaveform = () => {
        analyser.getByteTimeDomainData(samples);
        const segmentSize = Math.max(1, Math.floor(samples.length / 27));
        const levels = Array.from({ length: 27 }, (_, index) => {
          let peak = 0;
          const start = index * segmentSize;
          const end = Math.min(samples.length, start + segmentSize);
          for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
            peak = Math.max(peak, Math.abs(samples[sampleIndex] - 128));
          }
          return Math.max(6, Math.min(52, 6 + peak * 1.45));
        });
        setWaveform(levels);

        const elapsed = Math.min(60, Math.floor((performance.now() - recordingStartedAtRef.current) / 1000));
        setRecordingSeconds(elapsed);
        if (elapsed >= 60) {
          stopRecording();
          return;
        }
        animationFrameRef.current = requestAnimationFrame(drawWaveform);
      };

      animationFrameRef.current = requestAnimationFrame(drawWaveform);
    } catch {
      releaseAudioResources();
      setVoiceState("error");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setVoiceState("saving");
      recorder.stop();
    } else {
      setVoiceState("error");
    }
    recorderRef.current = null;
    releaseAudioResources(false);
  }

  function releaseAudioResources(stopRecorder = true) {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    if (stopRecorder && recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }

  const canContinue = media.length > 0;

  return (
    <div className="create-app">
      <header className="create-topbar">
        <button className="brand" type="button" onClick={onCancel} aria-label="返回记忆空间">
          <LogoMark /><span><strong>PlaceEcho</strong><small>创建新回忆</small></span>
        </button>
        <button className="cancel-button" type="button" onClick={onCancel}>退出创建</button>
      </header>

      <header className="mobile-create-toolbar">
        <button className="toolbar-exit" type="button" onClick={step === 0 ? onCancel : goToPreviousStep} aria-label={step === 0 ? "退出创建回忆" : "返回上一步"}>
          {step === 0 ? <CloseIcon /> : <ChevronLeftIcon />}
        </button>
        <div className="mobile-create-title">
          <i aria-hidden="true">
            {[0, 1, 2].map((index) => <b className={index < step ? "complete" : index === step ? "current" : ""} key={index} />)}
          </i>
          <span className="visually-hidden" role="status" aria-live="polite">创建回忆，第 {step + 1} 步，共 3 步：{["获取全景图", "为这里选择一些回忆", "说说这个空间"][step]}</span>
        </div>
      </header>

      <main className="create-shell" aria-labelledby="create-heading">
        <header className="create-heading">
          <div><h1 id="create-heading">创建新回忆</h1></div>
          <p>先提供空间的 360° 全景，再选择与这个空间线索有关的个人媒体</p>
        </header>

        <ol className="stepper" aria-label="创建进度">
          {["空间全景", "相关媒体", "语音记录"].map((label, index) => (
            <li className={index === step ? "active" : index < step ? "complete" : ""} aria-current={index === step ? "step" : undefined} key={label}>
              <span>{index < step ? <CheckIcon /> : index + 1}</span><small>{label}</small>
            </li>
          ))}
        </ol>

        <section className="create-panel">
          {step === 0 && (
            <div className="panel-content panorama-step">
              <div className="panel-title"><h2 ref={stepHeadingRef} tabIndex={-1}>获取全景图</h2><p>连接全景相机拍摄，或导入已有全景</p></div>
              <div className="acquisition-options">
                <button
                  className="camera-capture-option"
                  type="button"
                  disabled={captureState === "requesting"}
                  onClick={() =>
                    onCapturePanorama
                      ? onCapturePanorama()
                      : completePanorama("Insta360 空间全景.jpg")
                  }
                >
                  <span className="acquisition-icon acquisition-icon-camera"><PanoramicCameraIcon /></span>
                  <strong>{captureState === "requesting" ? "正在拍摄…" : "现在拍摄"}</strong>
                  <small>
                    {captureState === "staged"
                      ? "已保存在 iPhone，请恢复网络后继续"
                      : captureState === "failed"
                        ? "拍摄失败，请重试"
                        : "通过 iPhone 连接 Insta360 相机"}
                  </small>
                </button>
                <button type="button" onClick={() => panoramaInput.current?.click()}>
                  <span className="acquisition-icon acquisition-icon-panorama"><PanoramaIcon /></span><strong>导入已有</strong><small>选择设备中的 360° 全景图</small>
                </button>
              </div>
              <button className="demo-button" type="button" onClick={() => completePanorama("演示空间全景.jpg")}>使用演示全景完成预览</button>
              <input ref={panoramaInput} className="visually-hidden" type="file" accept="image/*" onChange={choosePanorama} />
            </div>
          )}

          {step === 1 && (
            <div className="panel-content media-step">
              <div className="panel-title"><h2 ref={stepHeadingRef} tabIndex={-1}>为这里选择一些回忆</h2><p>添加 6–12 项照片、视频或声音</p></div>
              <button className="media-upload" type="button" onClick={() => mediaInput.current?.click()}>
                <UploadIcon /><span><strong>从设备选择</strong><small>可一次选择多项</small></span>
              </button>
              <input ref={mediaInput} className="visually-hidden" type="file" multiple accept="image/*,video/*,audio/*" onChange={chooseMedia} />
              {media.length === 0 ? (
                <div className="demo-media-entry"><button className="demo-button" type="button" onClick={() => setMedia(demoMedia)}>使用 6 项演示媒体</button></div>
              ) : (
                <div className="selected-media-list">
                  <div className="selected-media-heading"><strong role="status" aria-live="polite">已选择 {media.length} 项</strong><button type="button" onClick={() => mediaInput.current?.click()}>继续添加</button></div>
                  {media.map((item) => (
                    <div className="selected-media-row" key={item.clientKey}>
                      <span className="file-icon"><FileIcon kind={item.kind} /></span>
                      <span><strong>{item.name}</strong><small>{item.kind} · {item.size}</small></span>
                      <button type="button" onClick={() => setMedia((current) => current.filter((entry) => entry.clientKey !== item.clientKey))} aria-label={`移除 ${item.name}`}>移除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="panel-content voice-step">
              <div className="panel-title"><h2 ref={stepHeadingRef} tabIndex={-1}>说说这个空间</h2><p>它是什么地方？你为什么想把它留下？</p></div>
              <div className={`voice-recorder voice-recorder-${voiceState}`}>
                <strong>{formatDuration(recordingSeconds)}</strong>
                <small role={voiceState === "error" ? "alert" : "status"} aria-live={voiceState === "error" ? "assertive" : "polite"}>{voiceState === "requesting" ? "正在连接麦克风" : voiceState === "recording" ? "正在录音" : voiceState === "saving" ? "正在保存录音" : voiceState === "recorded" ? "录音已完成" : voiceState === "error" ? "请允许麦克风访问" : "最长 60 秒"}</small>
                <div className="voice-wave" aria-hidden="true">{waveform.map((height, index) => <i style={{ height }} key={index} />)}</div>
                {voiceState === "recorded" ? (
                  <span className="record-button record-complete" aria-hidden="true"><CheckIcon /></span>
                ) : (
                  <button className="record-button" type="button" disabled={voiceState === "requesting"} onClick={voiceState === "recording" ? stopRecording : startRecording} aria-label={voiceState === "recording" ? "停止录音" : "开始录音"}>
                    {voiceState === "recording" ? <StopIcon /> : <MicrophoneIcon />}
                  </button>
                )}
                {voiceState === "recorded" && <button className="rerecord-button" type="button" onClick={startRecording}>重新录制</button>}
              </div>
              <label className="memory-note-field">
                <textarea
                  value={contextText}
                  maxLength={500}
                  onChange={(event) => setContextText(event.target.value)}
                  placeholder="也可以直接写下这个空间对你意味着什么（选填）"
                />
                <span>{contextText.length}/500</span>
              </label>
              {submissionError && <p role="alert">{submissionError}</p>}
            </div>
          )}

          {step > 0 && <footer className="panel-actions">
            {step === 1 ? (
              <button className="primary-button" type="button" disabled={!canContinue} onClick={() => setStep((step + 1) as 1 | 2)}>继续</button>
            ) : (
              <button className="primary-button" type="button" disabled={submitting || voiceState === "requesting" || voiceState === "recording" || voiceState === "saving"} onClick={createMemory}>{submitting ? "正在保存…" : "创建回忆"}</button>
            )}
          </footer>}
        </section>
      </main>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  return `00:${String(seconds).padStart(2, "0")}`;
}

function LogoMark() { return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M6 20c5-8 13-12 24-10-3 11-10 17-20 16" /><path d="M9 26c5-5 10-8 17-11" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>; }
function PanoramaIcon() { return <svg viewBox="0 0 40 22" aria-hidden="true"><path d="M3 5c10-3 24-3 34 0v12c-10-3-24-3-34 0V5Z" /><path d="m5 15 8-6 6 4 5-3 11 5" /><circle cx="29.5" cy="8" r="1.5" /></svg>; }
function UploadIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 14v5h14v-5" /></svg>; }
function MediaIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 5-5 3 3 2-2 4 4" /></svg>; }
function MicrophoneIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>; }
function PanoramicCameraIcon() { return <svg viewBox="0 0 24 28" aria-hidden="true"><rect x="6" y="1.5" width="12" height="25" rx="4" /><circle cx="12" cy="8" r="4" /></svg>; }
function StopIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" /></svg>; }
function ChevronLeftIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>; }
function FileIcon({ kind }: { kind: SelectedMedia["kind"] }) { return kind === "视频" ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2" /></svg> : kind === "声音" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 10v4" /></svg> : <MediaIcon />; }
