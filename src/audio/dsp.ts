/** Pure sample-processing helpers (Float32Array channels), unit tested in Node. */

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** [start, end) frame range whose |sample| exceeds the threshold in any channel; null when all silent. */
export function activeRange(chs: readonly Float32Array[], thresholdDb = -45): [number, number] | null {
  const thr = dbToGain(thresholdDb);
  let start = Infinity;
  let end = -1;
  for (const ch of chs) {
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) > thr) {
        if (i < start) start = i;
        break;
      }
    }
    for (let i = ch.length - 1; i >= 0; i--) {
      if (Math.abs(ch[i]) > thr) {
        if (i + 1 > end) end = i + 1;
        break;
      }
    }
  }
  return end < 0 || start === Infinity ? null : [start, end];
}

/** Trims leading/trailing silence. All-silent input is returned unchanged. */
export function trimSilence(chs: readonly Float32Array[], thresholdDb = -45): Float32Array[] {
  const r = activeRange(chs, thresholdDb);
  if (!r) return chs.map((c) => c.slice());
  return chs.map((c) => c.slice(r[0], r[1]));
}

export function peak(chs: readonly Float32Array[]): number {
  let p = 0;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

/** Scales in place so the peak is targetDb dBFS. Silent input is left alone. */
export function normalizePeak(chs: Float32Array[], targetDb = -1): void {
  const p = peak(chs);
  if (p <= 1e-6) return;
  const g = dbToGain(targetDb) / p;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

/** Linear fade in/out in place (each fade limited to half the clip). */
export function applyFades(chs: Float32Array[], sampleRate: number, ms = 5): void {
  for (const ch of chs) {
    const n = Math.min(Math.floor((sampleRate * ms) / 1000), Math.floor(ch.length / 2));
    for (let i = 0; i < n; i++) {
      const g = i / n;
      ch[i] *= g;
      ch[ch.length - 1 - i] *= g;
    }
  }
}

/** trim -> normalize -> fades. */
export function processSample(chs: readonly Float32Array[], sampleRate: number): Float32Array[] {
  const out = trimSilence(chs, -45);
  normalizePeak(out, -1);
  applyFades(out, sampleRate, 5);
  return out;
}

/** Random variant index in [0, n) that differs from `last` when n > 1. rand is in [0, 1). */
export function pickVariant(n: number, last: number, rand: () => number = Math.random): number {
  if (n <= 1) return 0;
  if (last < 0 || last >= n) return Math.min(n - 1, Math.floor(rand() * n));
  const i = Math.min(n - 2, Math.floor(rand() * (n - 1)));
  return i >= last ? i + 1 : i;
}
