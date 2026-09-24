# Memory AI

Semantic media grouping, Memory naming/summary, optional Scene Context
description, and source-panorama cue extraction. Primarily owned by Zou.
`MemoryAnalysisService` loads 1–16 selected Scene JPG/PNG/WebP, M4A/WAV/WebM,
or MP4/MOV assets plus the completed stitched panorama, calls a replaceable
analyzer, validates all IDs and coordinates, and persists 1–3 Memory results.
INSP uploads are excluded from default analysis selection. When the selection
contains exactly one audio asset, it also becomes `scene_context.audio_url`.
`BailianMemoryAnalyzer` is the default provider and uses the official Qwen3.8
Omni Chat Completions content forms for images, audio, and video. The standalone
Python multimedia prototype remains outside this API runtime. This boundary
never emits final 3D geometry.
