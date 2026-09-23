import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export interface PanoramaCleanerRequest {
  panorama: Uint8Array;
  maskPng: Uint8Array;
}

export interface PanoramaCleanerResult {
  panorama: Uint8Array;
  validation: Record<string, unknown> | null;
}

export interface PanoramaCleaner {
  isConfigured(): boolean;
  clean(request: PanoramaCleanerRequest): Promise<PanoramaCleanerResult>;
}

export class PanoramaCleanerUnavailableError extends Error {}

/**
 * Runs the tracked Python cleaner as a bounded child process. The Python
 * dependencies and model credentials stay outside the Node API process.
 */
export class CommandPanoramaCleaner implements PanoramaCleaner {
  constructor(
    private readonly python = process.env.PANORAMA_CLEANER_PYTHON ?? "python3",
    private readonly toolDirectory = process.env.PANORAMA_CLEANER_TOOL_DIR ??
      path.resolve("tools/qwen-panorama-cleaner"),
    private readonly configPath = process.env.PANORAMA_CLEANER_CONFIG ?? "",
  ) {}

  isConfigured(): boolean {
    return Boolean(
      process.env.DASHSCOPE_API_KEY &&
        process.env.DASHSCOPE_BASE_URL &&
        this.configPath,
    );
  }

  async clean(request: PanoramaCleanerRequest): Promise<PanoramaCleanerResult> {
    if (!this.isConfigured()) {
      throw new PanoramaCleanerUnavailableError(
        "Panorama cleaning requires DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL, and PANORAMA_CLEANER_CONFIG.",
      );
    }

    const temporary = await mkdtemp(
      path.join(tmpdir(), "placeecho-panorama-clean-"),
    );
    const inputPath = path.join(temporary, "panorama.jpg");
    const maskPath = path.join(temporary, "mask.png");
    const outputDirectory = path.join(temporary, "job");

    try {
      await Promise.all([
        writeFile(inputPath, request.panorama),
        writeFile(maskPath, request.maskPng),
      ]);
      try {
        await executeFile(
          this.python,
          [
            "-m",
            "qwen_panorama",
            "run",
            "--input",
            inputPath,
            "--config",
            path.resolve(this.configPath),
            "--mask",
            maskPath,
            "--out",
            outputDirectory,
            "--count",
            "1",
          ],
          {
            cwd: path.resolve(this.toolDirectory),
            env: process.env,
            timeout: 15 * 60 * 1_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
      } catch (error) {
        const commandError = error as Error & { stderr?: string };
        const detail = commandError.stderr?.trim().slice(-2_000);
        throw new Error(
          detail
            ? `Panorama cleaner failed: ${detail}`
            : `Panorama cleaner failed: ${commandError.message}`,
        );
      }

      const runDirectory = path.join(outputDirectory, "runs", "001");
      const [panorama, validationJson] = await Promise.all([
        readFile(path.join(runDirectory, "panorama_clean.jpg")),
        readFile(path.join(runDirectory, "validation.json"), "utf8"),
      ]);
      return {
        panorama,
        validation: JSON.parse(validationJson) as Record<string, unknown>,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
