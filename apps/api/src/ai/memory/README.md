# Memory AI

Semantic media grouping, Memory naming/summary, and source-panorama cue extraction. Primarily owned by Zou. `MemoryAnalysisService` loads selected Scene image bytes and the completed stitched panorama, calls a replaceable analyzer, validates all IDs and coordinates, and persists the result. `BailianMemoryAnalyzer` is the default provider. The standalone Python multimedia prototype remains outside this API runtime; API analysis currently supports JPG, PNG, and WebP assets only.
