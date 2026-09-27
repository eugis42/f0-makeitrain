import { defaultCrop, mountDualCropper, type CropState } from "./crop";
import {
  encodeFormat,
  encodePreviewBoth,
  EncodeAbortedError,
  type GenerateResult,
} from "./generate";
import type { FormatId } from "../engine/formats";
import { FORMATS, FORMAT_IDS } from "../engine/formats";
import { randomSeed } from "../engine/seed";
import { supportsWebGL2 } from "../engine/droplets";
import { supportsWebCodecsH264 } from "../encode/mp4";
import { iconArrowLeft, iconCircleCheck, iconTrash } from "./icons";

export type Stage = "upload" | "crop" | "generate" | "download";

const STAGES: Stage[] = ["upload", "crop", "generate", "download"];
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

type AppState = {
  stage: Stage;
  image: ImageBitmap | null;
  thumbUrl: string | null;
  fileName: string;
  selected: Record<FormatId, boolean>;
  crops: Record<FormatId, CropState>;
  seeds: Record<FormatId, number>;
  previews: Partial<Record<FormatId, GenerateResult>>;
  finals: Partial<Record<FormatId, GenerateResult>>;
  error: string | null;
  progressLabel: string;
  progressPct: number;
  frameHint: string;
  busy: boolean;
};

export function createApp(root: HTMLElement) {
  const state: AppState = {
    stage: "upload",
    image: null,
    thumbUrl: null,
    fileName: "",
    selected: { portrait: true, story: true },
    crops: { portrait: defaultCrop(), story: defaultCrop() },
    seeds: { portrait: randomSeed(), story: randomSeed() },
    previews: {},
    finals: {},
    error: null,
    progressLabel: "",
    progressPct: 0,
    frameHint: "",
    busy: false,
  };

  let cropper: ReturnType<typeof mountDualCropper> | null = null;
  let abortCtl: AbortController | null = null;
  const objectUrls: string[] = [];

  function selectedFormats(): FormatId[] {
    return FORMAT_IDS.filter((id) => state.selected[id]);
  }

  function revokePreviews() {
    for (const id of FORMAT_IDS) {
      const p = state.previews[id];
      if (p) URL.revokeObjectURL(p.url);
      const f = state.finals[id];
      if (f) URL.revokeObjectURL(f.url);
    }
    state.previews = {};
    state.finals = {};
  }

  function clearImage() {
    if (state.image) state.image.close();
    state.image = null;
    if (state.thumbUrl) URL.revokeObjectURL(state.thumbUrl);
    state.thumbUrl = null;
    state.fileName = "";
    state.crops = { portrait: defaultCrop(), story: defaultCrop() };
    state.seeds = { portrait: randomSeed(), story: randomSeed() };
    revokePreviews();
    state.error = null;
    if (state.stage !== "upload") state.stage = "upload";
    render();
  }

  function checkSupport(): string | null {
    if (!supportsWebGL2()) return "WebGL2 required. Try Chrome or Safari.";
    if (!supportsWebCodecsH264()) {
      return "WebCodecs H.264 encode required. Use recent Chrome or Safari.";
    }
    return null;
  }

  function setStage(next: Stage) {
    const from = STAGES.indexOf(state.stage);
    const to = STAGES.indexOf(next);
    if (to < from) {
      if (to <= STAGES.indexOf("generate")) {
        revokePreviews();
      }
      if (to === STAGES.indexOf("crop")) {
        revokePreviews();
      }
    }
    state.stage = next;
    state.error = null;
    render();
  }

  async function onFile(file: File) {
    state.error = null;
    if (!selectedFormats().length) {
      state.error = "Select at least one format.";
      render();
      return;
    }
    if (!ACCEPT.includes(file.type)) {
      state.error = "Use JPEG, PNG, or WebP.";
      render();
      return;
    }
    if (file.size > MAX_BYTES) {
      state.error = "Max file size is 20MB.";
      render();
      return;
    }
    try {
      if (state.image) state.image.close();
      if (state.thumbUrl) URL.revokeObjectURL(state.thumbUrl);
      revokePreviews();
      state.image = await createImageBitmap(file);
      state.thumbUrl = URL.createObjectURL(file);
      state.fileName = file.name;
      state.crops = { portrait: defaultCrop(), story: defaultCrop() };
      state.seeds = { portrait: randomSeed(), story: randomSeed() };
      setStage("crop");
    } catch {
      state.error = "Could not read image.";
      render();
    }
  }

  function cancelEncode() {
    abortCtl?.abort();
  }

  async function runGenerate() {
    if (!state.image) return;
    const supportErr = checkSupport();
    if (supportErr) {
      state.error = supportErr;
      render();
      return;
    }
    if (!selectedFormats().length) {
      state.error = "Select at least one format.";
      setStage("upload");
      return;
    }
    if (cropper) state.crops = cropper.getCrops();
    abortCtl?.abort();
    abortCtl = new AbortController();
    state.stage = "generate";
    state.busy = true;
    state.progressPct = 0;
    state.progressLabel = "Rendering preview…";
    state.frameHint = "";
    state.error = null;
    revokePreviews();
    render();

    try {
      state.previews = await encodePreviewBoth({
        image: state.image,
        crops: state.crops,
        seeds: state.seeds,
        formats: selectedFormats(),
        signal: abortCtl.signal,
        onProgress: ({ format, done, total, overallDone, overallTotal }) => {
          state.progressPct = Math.round((overallDone / overallTotal) * 100);
          state.progressLabel = `${FORMATS[format].label}`;
          state.frameHint = `Frame ${done} / ${total} · ${state.progressPct}% overall`;
          updateProgressDom();
        },
      });
      state.busy = false;
      state.stage = "download";
      render();
    } catch (err) {
      state.busy = false;
      if (err instanceof EncodeAbortedError) {
        state.error = null;
        state.stage = "crop";
        render();
        return;
      }
      state.error = err instanceof Error ? err.message : String(err);
      state.stage = "crop";
      render();
    }
  }

  async function randomise(id: FormatId) {
    if (!state.image || state.busy) return;
    const ok = window.confirm(
      `Re-render ${FORMATS[id].label} preview? This can take a while.`,
    );
    if (!ok) return;

    state.seeds[id] = randomSeed();
    const oldFinal = state.finals[id];
    if (oldFinal) URL.revokeObjectURL(oldFinal.url);
    delete state.finals[id];
    const old = state.previews[id];
    if (old) URL.revokeObjectURL(old.url);
    delete state.previews[id];

    abortCtl?.abort();
    abortCtl = new AbortController();
    state.busy = true;
    state.progressPct = 0;
    state.progressLabel = FORMATS[id].label;
    state.frameHint = "Starting…";
    render();
    try {
      state.previews[id] = await encodeFormat({
        image: state.image,
        crop: state.crops[id],
        seed: state.seeds[id],
        format: id,
        pass: "preview",
        signal: abortCtl.signal,
        onProgress: ({ done, total }) => {
          state.progressPct = Math.round((done / total) * 100);
          state.progressLabel = FORMATS[id].label;
          state.frameHint = `Frame ${done} / ${total}`;
          updateProgressDom();
        },
      });
      state.busy = false;
      render();
    } catch (err) {
      state.busy = false;
      if (err instanceof EncodeAbortedError) {
        render();
        return;
      }
      state.error = err instanceof Error ? err.message : String(err);
      render();
    }
  }

  async function retryPreview(id: FormatId) {
    if (!state.image || state.busy) return;
    abortCtl?.abort();
    abortCtl = new AbortController();
    state.busy = true;
    state.progressPct = 0;
    state.progressLabel = FORMATS[id].label;
    state.frameHint = "Retrying…";
    state.error = null;
    render();
    try {
      state.previews[id] = await encodeFormat({
        image: state.image,
        crop: state.crops[id],
        seed: state.seeds[id],
        format: id,
        pass: "preview",
        signal: abortCtl.signal,
        onProgress: ({ done, total }) => {
          state.progressPct = Math.round((done / total) * 100);
          state.progressLabel = FORMATS[id].label;
          state.frameHint = `Frame ${done} / ${total}`;
          updateProgressDom();
        },
      });
      state.busy = false;
      render();
    } catch (err) {
      state.busy = false;
      if (err instanceof EncodeAbortedError) {
        render();
        return;
      }
      state.error = err instanceof Error ? err.message : String(err);
      render();
    }
  }

  async function exportFinal(id: FormatId) {
    if (!state.image || state.busy) return;
    const existing = state.finals[id];
    if (existing) {
      downloadBlob(existing.blob, filename(id, state.seeds[id]));
      return;
    }
    abortCtl?.abort();
    abortCtl = new AbortController();
    state.busy = true;
    state.progressPct = 0;
    state.progressLabel = FORMATS[id].label;
    state.frameHint = "Exporting full MP4…";
    render();
    try {
      const result = await encodeFormat({
        image: state.image,
        crop: state.crops[id],
        seed: state.seeds[id],
        format: id,
        pass: "final",
        signal: abortCtl.signal,
        onProgress: ({ done, total }) => {
          state.progressPct = Math.round((done / total) * 100);
          state.progressLabel = FORMATS[id].label;
          state.frameHint = `Frame ${done} / ${total}`;
          updateProgressDom();
        },
      });
      state.finals[id] = result;
      state.busy = false;
      render();
      downloadBlob(result.blob, filename(id, state.seeds[id]));
    } catch (err) {
      state.busy = false;
      if (err instanceof EncodeAbortedError) {
        render();
        return;
      }
      state.error = err instanceof Error ? err.message : String(err);
      render();
    }
  }

  function filename(id: FormatId, seed: number) {
    return `feelnothing-${id}-${seed.toString(16).padStart(8, "0")}.mp4`;
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  function updateProgressDom() {
    const bar = root.querySelector(".progress") as HTMLElement | null;
    const fill = root.querySelector(".progress-fill") as HTMLElement | null;
    const label = root.querySelector(".progress-label") as HTMLElement | null;
    const hint = root.querySelector(".progress-hint") as HTMLElement | null;
    const pct = root.querySelector(".progress-pct") as HTMLElement | null;
    if (fill) fill.style.width = `${state.progressPct}%`;
    if (bar) {
      bar.setAttribute("aria-valuenow", String(state.progressPct));
      bar.setAttribute(
        "aria-valuetext",
        `${state.progressLabel}. ${state.frameHint}`,
      );
    }
    if (label) label.textContent = state.progressLabel;
    if (hint) hint.textContent = state.frameHint;
    if (pct) pct.textContent = `${state.progressPct}%`;
  }

  function stageBarHtml() {
    const current = STAGES.indexOf(state.stage);
    return `
      <nav class="stage-bar" aria-label="Steps">
        ${STAGES.map((s, i) => {
          const enabled = i <= current && !state.busy;
          const active = s === state.stage;
          const past = i < current;
          return `
            <button type="button"
              class="stage-step${active ? " is-active" : ""}${past ? " is-past" : ""}"
              data-stage="${s}"
              ${enabled ? "" : "disabled"}
              aria-current="${active ? "step" : "false"}">
              <span class="stage-num">${i + 1}</span>
              <span class="stage-name">${labelStage(s)}</span>
            </button>`;
        }).join('<span class="stage-sep" aria-hidden="true"></span>')}
      </nav>
    `;
  }

  function stageActionsHtml() {
    const none = !selectedFormats().length;
    if (state.stage === "crop" && state.image) {
      return `
        <div class="stage-actions">
          <button type="button" class="btn btn-icon" data-action="back" aria-label="Back">
            ${iconArrowLeft()}
          </button>
          <button type="button" class="btn btn-primary" data-action="continue">Continue</button>
        </div>`;
    }
    if (state.stage === "upload" && state.image) {
      return `
        <div class="stage-actions">
          <button type="button" class="btn btn-primary" data-action="to-crop" ${none ? "disabled" : ""}>Continue to crop</button>
        </div>`;
    }
    return `<div class="stage-actions" hidden></div>`;
  }

  function labelStage(s: Stage) {
    return s[0].toUpperCase() + s.slice(1);
  }

  function progressBlockHtml() {
    return `
      <p class="progress-label" aria-live="polite">${escapeHtml(state.progressLabel)}</p>
      <p class="progress-hint" aria-live="polite">${escapeHtml(state.frameHint)}</p>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow="${state.progressPct}"
        aria-valuetext="${escapeHtml(state.progressLabel)}. ${escapeHtml(state.frameHint)}">
        <div class="progress-fill" style="width:${state.progressPct}%"></div>
      </div>
      <p class="progress-pct">${state.progressPct}%</p>
    `;
  }

  function wireChromeActions() {
    root.querySelector('[data-action="back"]')?.addEventListener("click", () => {
      setStage("upload");
    });
    root.querySelector('[data-action="continue"]')?.addEventListener("click", () => {
      if (cropper) state.crops = cropper.getCrops();
      void runGenerate();
    });
    root.querySelector('[data-action="to-crop"]')?.addEventListener("click", () => {
      if (!selectedFormats().length) {
        state.error = "Select at least one format.";
        render();
        return;
      }
      setStage("crop");
    });
  }

  function render() {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }

    const supportErr = checkSupport();

    root.innerHTML = `
      <div class="shell">
        <header class="top">
          <p class="brand">Ⓕ MAKE IT RAIN</p>
        </header>
        <div class="chrome-row">
          ${stageBarHtml()}
          ${stageActionsHtml()}
        </div>
        ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
        ${supportErr && state.stage === "upload" ? `<p class="error" role="alert">${escapeHtml(supportErr)}</p>` : ""}
        <main class="main" data-stage="${state.stage}"></main>
      </div>
    `;

    const main = root.querySelector(".main") as HTMLElement;

    root.querySelectorAll(".stage-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = (btn as HTMLElement).dataset.stage as Stage;
        if (s && !state.busy) setStage(s);
      });
    });
    wireChromeActions();

    if (state.stage === "upload") renderUpload(main);
    else if (state.stage === "crop") renderCrop(main);
    else if (state.stage === "generate") renderGenerate(main);
    else renderDownload(main);
  }

  function renderUpload(main: HTMLElement) {
    const none = !selectedFormats().length;
    const hasImage = !!state.image;
    main.innerHTML = `
      <section class="panel">
        <h1 class="title">${hasImage ? "Photo ready" : "Upload a photo"}</h1>
        <p class="lede">JPEG, PNG, or WebP · max 20MB. Pick formats${hasImage ? ", then continue or replace the photo" : ", then drop a photo"}.</p>
        <div class="format-picks" role="group" aria-label="Formats">
          ${FORMAT_IDS.map((id) => {
            const on = state.selected[id];
            return `
            <button type="button" class="format-pick${on ? " is-on" : ""}"
              data-format="${id}"
              aria-pressed="${on ? "true" : "false"}">
              ${on ? iconCircleCheck("icon icon-check") : ""}
              <span>${FORMATS[id].label}</span>
            </button>`;
          }).join("")}
        </div>
        ${none ? `<p class="hint-warn">Select at least one format to continue.</p>` : ""}
        ${
          hasImage
            ? `<div class="dropzone dropzone--filled">
                <img class="dropzone-thumb" src="${state.thumbUrl ?? ""}" alt="" />
                <button type="button" class="btn btn-icon dropzone-delete" data-action="clear" aria-label="Remove photo">
                  ${iconTrash()}
                </button>
                <label class="dropzone-replace${none ? " is-disabled" : ""}">
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden ${none ? "disabled" : ""} />
                  <span>Replace</span>
                </label>
              </div>
              <p class="file-name">${escapeHtml(state.fileName || "Current photo")}</p>`
            : `<label class="dropzone${none ? " is-disabled" : ""}">
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden ${none ? "disabled" : ""} />
                <span>Drop image here or click to choose</span>
              </label>`
        }
      </section>
    `;

    main.querySelectorAll<HTMLButtonElement>(".format-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.format as FormatId;
        state.selected[id] = !state.selected[id];
        state.error = null;
        render();
      });
    });

    main.querySelector('[data-action="clear"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearImage();
    });

    const input = main.querySelector('input[type="file"]') as HTMLInputElement | null;
    const zone = main.querySelector(".dropzone") as HTMLElement | null;
    input?.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void onFile(f);
    });
    zone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!none) zone.classList.add("is-hot");
    });
    zone?.addEventListener("dragleave", () => zone.classList.remove("is-hot"));
    zone?.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-hot");
      if (none) {
        state.error = "Select at least one format.";
        render();
        return;
      }
      const f = e.dataTransfer?.files?.[0];
      if (f) void onFile(f);
    });
  }

  function renderCrop(main: HTMLElement) {
    if (!state.image) {
      setStage("upload");
      return;
    }
    const formats = selectedFormats();
    if (!formats.length) {
      setStage("upload");
      return;
    }
    const multi = formats.length > 1;
    main.innerHTML = `
      <section class="panel">
        <h1 class="title">${multi ? "Crop formats" : `Crop ${FORMATS[formats[0]].label}`}</h1>
        <p class="lede">Pan and zoom${multi ? " each frame" : ""}. Same photo, rain overlays your crop.</p>
        <div class="crop-host"></div>
      </section>
    `;
    const host = main.querySelector(".crop-host") as HTMLElement;
    cropper = mountDualCropper(
      host,
      state.image,
      state.crops,
      {
        onChange(format, crop) {
          state.crops[format] = crop;
        },
      },
      formats,
    );
  }

  function renderGenerate(main: HTMLElement) {
    main.innerHTML = `
      <section class="panel panel-center">
        <h1 class="title">Rendering…</h1>
        ${progressBlockHtml()}
        <div class="actions">
          <button type="button" class="btn" data-action="cancel">Cancel</button>
        </div>
      </section>
    `;
    main.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      cancelEncode();
    });
  }

  function renderDownload(main: HTMLElement) {
    main.innerHTML = `
      <section class="panel">
        <h1 class="title">Download</h1>
        <p class="lede">Preview loops muted. Export builds a silent 1080p · 60fps · 10s MP4.</p>
        ${state.busy ? `${progressBlockHtml()}
          <div class="actions">
            <button type="button" class="btn" data-action="cancel">Cancel</button>
          </div>` : ""}
        <div class="dl-grid${selectedFormats().length === 1 ? " dl-grid--single" : ""}">
          ${selectedFormats()
            .map((id) => {
              const preview = state.previews[id];
              const final = state.finals[id];
              return `
              <article class="dl-card">
                <p class="crop-label">${FORMATS[id].label}</p>
                ${
                  preview
                    ? `<div class="preview-wrap preview-wrap--${id}">
                        <video class="preview preview--${id}" src="${preview.url}" controls muted loop playsinline webkit-playsinline></video>
                        <button type="button" class="btn btn-play is-hidden" data-play="${id}">Play preview</button>
                      </div>`
                    : `<div class="preview-empty">
                        <p class="muted">Preview failed or missing.</p>
                        <button type="button" class="btn" data-retry="${id}" ${state.busy ? "disabled" : ""}>Retry preview</button>
                      </div>`
                }
                <div class="actions">
                  <button type="button" class="btn btn-secondary" data-rand="${id}" ${state.busy || !preview ? "disabled" : ""}>Randomise</button>
                  <button type="button" class="btn btn-primary" data-export="${id}" ${state.busy || !preview ? "disabled" : ""}>
                    ${final ? "Download MP4" : "Export MP4"}
                  </button>
                </div>
              </article>
            `;
            })
            .join("")}
        </div>
      </section>
    `;

    main.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      cancelEncode();
    });

    main.querySelectorAll("[data-rand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void randomise((btn as HTMLElement).dataset.rand as FormatId);
      });
    });
    main.querySelectorAll("[data-export]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void exportFinal((btn as HTMLElement).dataset.export as FormatId);
      });
    });
    main.querySelectorAll("[data-retry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void retryPreview((btn as HTMLElement).dataset.retry as FormatId);
      });
    });

    main.querySelectorAll<HTMLVideoElement>("video.preview").forEach((v) => {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      const wrap = v.closest(".preview-wrap");
      const playBtn = wrap?.querySelector<HTMLButtonElement>(".btn-play");
      const showPlay = () => playBtn?.classList.remove("is-hidden");
      const hidePlay = () => playBtn?.classList.add("is-hidden");
      playBtn?.addEventListener("click", () => {
        void v.play().then(hidePlay).catch(showPlay);
      });
      void v
        .play()
        .then(() => {
          hidePlay();
          v.loop = true;
        })
        .catch(() => {
          showPlay();
        });
    });
  }

  render();

  return {
    destroy() {
      abortCtl?.abort();
      if (cropper) cropper.destroy();
      revokePreviews();
      if (state.thumbUrl) URL.revokeObjectURL(state.thumbUrl);
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
      if (state.image) state.image.close();
    },
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
