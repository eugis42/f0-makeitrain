export type FormatId = "portrait" | "story";

export type FormatSpec = {
  id: FormatId;
  label: string;
  width: number;
  height: number;
  aspect: number;
};

export const FORMATS: Record<FormatId, FormatSpec> = {
  portrait: {
    id: "portrait",
    label: "Portrait 4:5",
    width: 1080,
    height: 1350,
    aspect: 1080 / 1350,
  },
  story: {
    id: "story",
    label: "Story 9:16",
    width: 1080,
    height: 1920,
    aspect: 1080 / 1920,
  },
};

export const FORMAT_IDS: FormatId[] = ["portrait", "story"];

export const DURATION_SEC = 10;
export const FINAL_FPS = 60;
export const PREVIEW_FPS = 30;
export const PREVIEW_SCALE = 0.5;

/** H.264 encoders reject odd widths/heights (portrait half-res was 540×675). */
export function evenSize(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v - (v % 2);
}
