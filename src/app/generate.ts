import { createDroplets } from "../engine/droplets";
import type { FormatId, FormatSpec } from "../engine/formats";
import {
  DURATION_SEC,
  FINAL_FPS,
  FORMAT_IDS,
  FORMATS,
  PREVIEW_FPS,
  PREVIEW_SCALE,
  evenSize,
} from "../engine/formats";
import { encodeMp4, EncodeAbortedError } from "../encode/mp4";
import type { CropState } from "./crop";
import { paintCroppedPhoto } from "./crop";

export { EncodeAbortedError };

export type PassKind = "preview" | "final";

export type GenerateResult = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  fps: number;
  seed: number;
};

export type ProgressFn = (info: {
  format: FormatId;
  pass: PassKind;
  done: number;
  total: number;
  overallDone: number;
  overallTotal: number;
}) => void;

function passSize(format: FormatSpec, pass: PassKind) {
  if (pass === "preview") {
    return {
      width: evenSize(format.width * PREVIEW_SCALE),
      height: evenSize(format.height * PREVIEW_SCALE),
      fps: PREVIEW_FPS,
    };
  }
  return {
    width: evenSize(format.width),
    height: evenSize(format.height),
    fps: FINAL_FPS,
  };
}

export async function encodeFormat(opts: {
  image: ImageBitmap;
  crop: CropState;
  seed: number;
  format: FormatId;
  pass: PassKind;
  onProgress?: ProgressFn;
  overallOffset?: number;
  overallTotal?: number;
  signal?: AbortSignal;
}): Promise<GenerateResult> {
  const format = FORMATS[opts.format];
  const { width, height, fps } = passSize(format, opts.pass);
  const frameCount = Math.round(DURATION_SEC * fps);

  const source = document.createElement("canvas");
  const output = document.createElement("canvas");
  // Offscreen sizing — not in DOM
  output.width = width;
  output.height = height;
  source.width = width;
  source.height = height;

  const cropForPass: CropState = {
    x: opts.crop.x * (width / format.width),
    y: opts.crop.y * (height / format.height),
    scale: opts.crop.scale,
  };

  const paintContent = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintCroppedPhoto(ctx, opts.image, cropForPass, canvas.width, canvas.height);
  };

  const droplets = createDroplets(
    { source, output, paintContent },
    {
      width,
      height,
      seed: opts.seed,
      interactive: false,
      keep: 1,
    },
  );

  if (!droplets) {
    throw new Error("WebGL2 unavailable — cannot render rain.");
  }

  // Paint once more after create
  paintContent(source);
  droplets.setSeed(opts.seed);

  const overallOffset = opts.overallOffset ?? 0;
  const overallTotal = opts.overallTotal ?? frameCount;

  try {
    const blob = await encodeMp4({
      width,
      height,
      fps,
      frameCount,
      canvas: output,
      signal: opts.signal,
      renderFrame: (i) => {
        droplets.renderFrame(i, fps);
      },
      onProgress: (done, total) => {
        opts.onProgress?.({
          format: opts.format,
          pass: opts.pass,
          done,
          total,
          overallDone: overallOffset + done,
          overallTotal,
        });
      },
    });

    return {
      blob,
      url: URL.createObjectURL(blob),
      width,
      height,
      fps,
      seed: opts.seed,
    };
  } finally {
    droplets.destroy();
  }
}

export async function encodePreviewBoth(opts: {
  image: ImageBitmap;
  crops: Record<FormatId, CropState>;
  seeds: Record<FormatId, number>;
  formats?: FormatId[];
  onProgress?: ProgressFn;
  signal?: AbortSignal;
}): Promise<Partial<Record<FormatId, GenerateResult>>> {
  const formats = opts.formats?.length ? opts.formats : ([...FORMAT_IDS] as FormatId[]);
  const totals = formats.map((id) => {
    const { fps } = passSize(FORMATS[id], "preview");
    return Math.round(DURATION_SEC * fps);
  });
  const overallTotal = totals.reduce((a, b) => a + b, 0);
  let offset = 0;
  const out: Partial<Record<FormatId, GenerateResult>> = {};

  for (let i = 0; i < formats.length; i++) {
    if (opts.signal?.aborted) throw new EncodeAbortedError();
    const id = formats[i];
    out[id] = await encodeFormat({
      image: opts.image,
      crop: opts.crops[id],
      seed: opts.seeds[id],
      format: id,
      pass: "preview",
      onProgress: opts.onProgress,
      overallOffset: offset,
      overallTotal,
      signal: opts.signal,
    });
    offset += totals[i];
  }

  return out;
}
