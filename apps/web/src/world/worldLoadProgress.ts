export type WorldLoadPhase = "opening" | "decoding" | "preparing";

export interface WorldLoadProgress {
  phase: WorldLoadPhase;
  value: number;
}

const ESTIMATED_SPZ_TRANSFER_MS = 240;
const DECODING_PROGRESS_START = 0.14;
const DECODING_PROGRESS_LIMIT = 0.94;
const DECODING_RESPONSE_MS = 6_000;

export function estimateWorldLoadProgress(
  elapsedMs: number,
): WorldLoadProgress {
  const safeElapsed = Math.max(elapsedMs, 0);
  if (safeElapsed < ESTIMATED_SPZ_TRANSFER_MS) {
    return {
      phase: "opening",
      value:
        0.03 +
        (DECODING_PROGRESS_START - 0.03) *
          (safeElapsed / ESTIMATED_SPZ_TRANSFER_MS),
    };
  }

  const decodingElapsed = safeElapsed - ESTIMATED_SPZ_TRANSFER_MS;
  const decodingRatio = 1 - Math.exp(-decodingElapsed / DECODING_RESPONSE_MS);
  return {
    phase: "decoding",
    value:
      DECODING_PROGRESS_START +
      (DECODING_PROGRESS_LIMIT - DECODING_PROGRESS_START) * decodingRatio,
  };
}
