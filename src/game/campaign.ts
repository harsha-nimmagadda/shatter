/** Pure campaign helpers. */

/** Stars for a cleared level: 1 = cleared, 2 = score >= thresholds[0], 3 = score >= thresholds[1]. */
export function levelStars(score: number, thresholds: readonly [number, number]): 1 | 2 | 3 {
  if (score >= thresholds[1]) return 3;
  if (score >= thresholds[0]) return 2;
  return 1;
}
