import type { FormatId, FormatSpec } from "../engine/formats";
import { FORMATS } from "../engine/formats";

/** Pan/zoom in image-cover space. scale ≥ 1 relative to cover-fit; x/y = pan in frame pixels at cover scale. */
export type CropState = {
  x: number;
  y: number;
  scale: number;
};

export function defaultCrop(): CropState {
  return { x: 0, y: 0, scale: 1 };
}

export function coverScale(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
): number {
  return Math.max(frameW / imgW, frameH / imgH);
}

export function paintCroppedPhoto(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap | HTMLImageElement,
  crop: CropState,
  frameW: number,
  frameH: number,
): void {
  const imgW = "width" in image ? image.width : (image as HTMLImageElement).naturalWidth;
  const imgH = "height" in image ? image.height : (image as HTMLImageElement).naturalHeight;
  const base = coverScale(imgW, imgH, frameW, frameH);
  const s = base * Math.max(crop.scale, 1);
  const drawW = imgW * s;
  const drawH = imgH * s;
  const { x, y } = clampPan(crop.x, crop.y, drawW, drawH, frameW, frameH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, frameW, frameH);
  ctx.drawImage(image, frameW / 2 + x - drawW / 2, frameH / 2 + y - drawH / 2, drawW, drawH);
}

export function clampPan(
  x: number,
  y: number,
  drawW: number,
  drawH: number,
  frameW: number,
  frameH: number,
): { x: number; y: number } {
  const maxX = Math.max(0, (drawW - frameW) / 2);
  const maxY = Math.max(0, (drawH - frameH) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

type CropperCallbacks = {
  onChange: (format: FormatId, crop: CropState) => void;
};

type PaneApi = {
  destroy: () => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
  refreshZoomLabel: () => void;
};

export function mountDualCropper(
  root: HTMLElement,
  image: ImageBitmap,
  crops: Record<FormatId, CropState>,
  cbs: CropperCallbacks,
  formats: FormatId[] = ["portrait", "story"],
): { destroy: () => void; getCrops: () => Record<FormatId, CropState> } {
  const active = formats.length ? formats : (["portrait", "story"] as FormatId[]);
  const state: Record<FormatId, CropState> = {
    portrait: { ...crops.portrait },
    story: { ...crops.story },
  };
  const multi = active.length > 1;
  let tab: FormatId = active[0];

  root.innerHTML = `
    ${
      multi
        ? `<div class="crop-tabs" role="tablist" aria-label="Formats">
      ${active
        .map(
          (id) => `
        <button type="button" class="crop-tab${id === tab ? " is-active" : ""}" role="tab"
          aria-selected="${id === tab}" data-tab="${id}">${FORMATS[id].label}</button>`,
        )
        .join("")}
    </div>`
        : ""
    }
    <div class="crop-grid${active.length === 1 ? " crop-grid--single" : ""}${multi ? " crop-grid--tabs" : ""}">
      ${active
        .map(
          (id) => `
        <div class="crop-pane${multi && id !== tab ? " crop-pane--inactive" : ""}" data-format="${id}" role="tabpanel">
          <p class="crop-label">${FORMATS[id].label}</p>
          <div class="crop-frame" data-format="${id}">
            <canvas class="crop-canvas" data-format="${id}"></canvas>
          </div>
          <div class="crop-tools">
            <button type="button" class="btn btn-ghost" data-zoom-out="${id}" aria-label="Zoom out">−</button>
            <span class="crop-zoom" data-zoom-label="${id}">100%</span>
            <button type="button" class="btn btn-ghost" data-zoom-in="${id}" aria-label="Zoom in">+</button>
            <button type="button" class="btn btn-ghost" data-reset="${id}">Reset</button>
          </div>
          <p class="crop-hint">Drag to pan · pinch / scroll to zoom</p>
        </div>`,
        )
        .join("")}
    </div>
  `;

  const panes = new Map<FormatId, PaneApi>();

  for (const id of active) {
    const frame = root.querySelector(`.crop-frame[data-format="${id}"]`) as HTMLElement;
    const canvas = root.querySelector(`.crop-canvas[data-format="${id}"]`) as HTMLCanvasElement;
    const zoomLabel = root.querySelector(`[data-zoom-label="${id}"]`) as HTMLElement;
    panes.set(
      id,
      wireCropViewport(frame, canvas, image, FORMATS[id], state, cbs, zoomLabel),
    );
  }

  const onTab = (id: FormatId) => {
    tab = id;
    root.querySelectorAll(".crop-tab").forEach((el) => {
      const btn = el as HTMLButtonElement;
      const on = btn.dataset.tab === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll(".crop-pane").forEach((el) => {
      const pane = el as HTMLElement;
      pane.classList.toggle("crop-pane--inactive", pane.dataset.format !== id);
    });
    // Relayout newly visible pane
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };

  root.querySelectorAll(".crop-tab").forEach((el) => {
    el.addEventListener("click", () => onTab((el as HTMLElement).dataset.tab as FormatId));
  });

  root.querySelectorAll("[data-zoom-in]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.zoomIn as FormatId;
      panes.get(id)?.zoomBy(1.08);
    });
  });
  root.querySelectorAll("[data-zoom-out]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.zoomOut as FormatId;
      panes.get(id)?.zoomBy(1 / 1.08);
    });
  });
  root.querySelectorAll("[data-reset]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.reset as FormatId;
      panes.get(id)?.reset();
    });
  });

  return {
    destroy() {
      panes.forEach((p) => p.destroy());
      root.innerHTML = "";
    },
    getCrops() {
      return {
        portrait: { ...state.portrait },
        story: { ...state.story },
      };
    },
  };
}

function wireCropViewport(
  frame: HTMLElement,
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  format: FormatSpec,
  state: Record<FormatId, CropState>,
  cbs: CropperCallbacks,
  zoomLabel: HTMLElement,
): PaneApi {
  const ctx = canvas.getContext("2d")!;
  let pointers = new Map<number, { x: number; y: number }>();
  let lastPinchDist = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function refreshZoomLabel() {
    zoomLabel.textContent = `${Math.round(state[format.id].scale * 100)}%`;
  }

  function layout() {
    const maxW = frame.clientWidth;
    if (!maxW || maxW < 2) return; // display:none (mobile inactive tab)
    const viewH = maxW / format.aspect;
    frame.style.height = `${viewH}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(maxW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = `${maxW}px`;
    canvas.style.height = `${viewH}px`;
    paint();
    refreshZoomLabel();
  }

  function paint() {
    const crop = state[format.id];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / format.width;
    const sy = canvas.height / format.height;
    const imgW = image.width;
    const imgH = image.height;
    const base = coverScale(imgW, imgH, format.width, format.height);
    const s = base * Math.max(crop.scale, 1);
    const drawW = imgW * s * sx;
    const drawH = imgH * s * sy;
    const pan = clampPan(crop.x * sx, crop.y * sy, drawW, drawH, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      image,
      canvas.width / 2 + pan.x - drawW / 2,
      canvas.height / 2 + pan.y - drawH / 2,
      drawW,
      drawH,
    );
  }

  function reclamp(id: FormatId) {
    const crop = state[id];
    const f = FORMATS[id];
    const base = coverScale(image.width, image.height, f.width, f.height);
    const s = base * Math.max(crop.scale, 1);
    const drawW = image.width * s;
    const drawH = image.height * s;
    const pan = clampPan(crop.x, crop.y, drawW, drawH, f.width, f.height);
    crop.x = pan.x;
    crop.y = pan.y;
  }

  function commit() {
    reclamp(format.id);
    cbs.onChange(format.id, { ...state[format.id] });
    paint();
    refreshZoomLabel();
  }

  function onPointerDown(e: PointerEvent) {
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    } else if (pointers.size === 2) {
      dragging = false;
      const pts = [...pointers.values()];
      lastPinchDist = dist(pts[0], pts[1]);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const viewW = frame.clientWidth || 1;
    const pxPerFormat = format.width / viewW;

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = dist(pts[0], pts[1]);
      if (lastPinchDist > 0) {
        const ratio = d / lastPinchDist;
        state[format.id].scale = Math.min(4, Math.max(1, state[format.id].scale * ratio));
        commit();
      }
      lastPinchDist = d;
      return;
    }

    if (!dragging) return;
    const dx = (e.clientX - lastX) * pxPerFormat;
    const dy = (e.clientY - lastY) * pxPerFormat;
    lastX = e.clientX;
    lastY = e.clientY;
    state[format.id].x += dx;
    state[format.id].y += dy;
    commit();
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) dragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.96 : 1.04;
    state[format.id].scale = Math.min(4, Math.max(1, state[format.id].scale * delta));
    commit();
  }

  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointercancel", onPointerUp);
  frame.addEventListener("wheel", onWheel, { passive: false });
  const ro = new ResizeObserver(layout);
  ro.observe(frame.parentElement || frame);
  layout();

  return {
    destroy() {
      ro.disconnect();
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerUp);
      frame.removeEventListener("pointercancel", onPointerUp);
      frame.removeEventListener("wheel", onWheel);
    },
    reset() {
      state[format.id] = defaultCrop();
      commit();
    },
    zoomBy(factor: number) {
      state[format.id].scale = Math.min(4, Math.max(1, state[format.id].scale * factor));
      commit();
    },
    refreshZoomLabel,
  };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
