/** 32-bit seed for rain pattern randomise. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function seedLabel(seed: number): string {
  return seed.toString(16).padStart(8, "0");
}
