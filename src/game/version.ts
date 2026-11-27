/** Pure: "v0.1.0 · abc1234" (just "v0.1.0" without a commit). */
export function formatVersion(version: string, commit: string): string {
  const v = version.trim() || '0.0.0';
  const c = commit.trim();
  return c ? `v${v} · ${c}` : `v${v}`;
}

export const versionString = (): string =>
  formatVersion(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '', typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '');
