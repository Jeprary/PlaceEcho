export interface PreparedImage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png" | "image/webp";
  resized: boolean;
  width: number | null;
  height: number | null;
}

const minimumResizeBytes = 512 * 1024;

export async function prepareImageForModel(
  bytes: Uint8Array,
  sourceName: string,
  limits: { width: number; height: number },
): Promise<PreparedImage> {
  if (bytes.length <= minimumResizeBytes) {
    return {
      bytes,
      mime: sourceMime(sourceName),
      resized: false,
      width: null,
      height: null,
    };
  }

  try {
    const output = await sharp(bytes, { failOn: "error", limitInputPixels: 200_000_000 })
      .rotate()
      .resize({
        width: limits.width,
        height: limits.height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length === 0 || output.data.length > 2 * 1024 * 1024) {
      throw new Error("The prepared image exceeds the safe model payload limit.");
    }
    return {
      bytes: output.data,
      mime: "image/jpeg",
      resized: true,
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The prepared image exceeds the safe model payload limit."
    ) {
      throw error;
    }
    throw new Error(`Unable to prepare ${sourceName} for multimodal analysis.`);
  }
}

function sourceMime(sourceName: string): PreparedImage["mime"] {
  const lower = sourceName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
import sharp from "sharp";
