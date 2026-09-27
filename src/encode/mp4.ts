import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export class EncodeAbortedError extends Error {
  constructor(message = "Encode cancelled") {
    super(message);
    this.name = "EncodeAbortedError";
  }
}

export type EncodeOptions = {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  /** Draw frame i into the canvas (0-based). */
  renderFrame: (frameIndex: number) => void;
  canvas: HTMLCanvasElement;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

export function supportsWebCodecsH264(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

function even(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v - (v % 2);
}

async function pickAvcConfig(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig | null> {
  const w = even(width);
  const h = even(height);
  const bitrate = Math.min(
    12_000_000,
    Math.max(1_000_000, Math.round(w * h * fps * 0.07)),
  );

  // Level must cover frame size: 1080×1920 ≈ level 4.0; odd dims always fail.
  const codecs = [
    "avc1.4D0028", // Main 4.0 — needed for 1080×1350 / 1080×1920
    "avc1.4D002A", // Main 4.1
    "avc1.640028", // High 4.0
    "avc1.640029", // High 4.1
    "avc1.640032", // High 5.0
    "avc1.42001F", // Baseline 3.1 — preview sizes
    "avc1.42001E", // Baseline 3.0
    "avc1.4D001F", // Main 3.1
    "avc1.42E01E", // Constrained Baseline (Safari)
    "avc1.42E01F",
  ];

  const accel: HardwareAcceleration[] = [
    "no-preference",
    "prefer-hardware",
    "prefer-software",
  ];

  for (const codec of codecs) {
    for (const hardwareAcceleration of accel) {
      for (const avc of [{ format: "avc" as const }, undefined]) {
        const config: VideoEncoderConfig = {
          codec,
          width: w,
          height: h,
          bitrate,
          framerate: fps,
          hardwareAcceleration,
          ...(avc ? { avc } : {}),
        };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) {
            const picked = support.config ?? config;
            // mp4-muxer needs avcC description → force avc format when possible
            if (!picked.avc) picked.avc = { format: "avc" };
            return picked;
          }
        } catch {
          /* try next */
        }
      }
    }
  }
  return null;
}

export async function encodeMp4(opts: EncodeOptions): Promise<Blob> {
  if (!supportsWebCodecsH264()) {
    throw new Error("WebCodecs VideoEncoder unavailable in this browser.");
  }

  const width = even(opts.width);
  const height = even(opts.height);
  const { fps, frameCount, renderFrame, canvas, onProgress, signal } = opts;

  if (signal?.aborted) throw new EncodeAbortedError();

  if (canvas.width !== width || canvas.height !== height) {
    throw new Error(
      `Canvas size ${canvas.width}×${canvas.height} must be even H.264 size ${width}×${height}.`,
    );
  }

  const config = await pickAvcConfig(width, height, fps);
  if (!config) {
    throw new Error(
      `H.264 (avc1) encode not supported for ${width}×${height} in this browser. Use recent Chrome or Safari.`,
    );
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width,
      height,
      frameRate: fps,
    },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encodeError: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encodeError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure(config);

  const frameDuration = 1_000_000 / fps; // µs

  const throwIfAborted = () => {
    if (signal?.aborted) {
      try {
        encoder.close();
      } catch {
        /* already closed */
      }
      throw new EncodeAbortedError();
    }
  };

  for (let i = 0; i < frameCount; i++) {
    throwIfAborted();
    if (encodeError) throw encodeError;
    renderFrame(i);
    const gl = canvas.getContext("webgl2");
    gl?.finish();

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });
    const keyFrame = i % Math.max(1, Math.round(fps * 2)) === 0;
    encoder.encode(frame, { keyFrame });
    frame.close();
    onProgress?.(i + 1, frameCount);

    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }

  throwIfAborted();
  await encoder.flush();
  if (encodeError) throw encodeError;
  encoder.close();
  muxer.finalize();

  return new Blob([target.buffer], { type: "video/mp4" });
}
