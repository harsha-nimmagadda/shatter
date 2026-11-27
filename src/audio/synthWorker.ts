/// <reference lib="webworker" />
import { SFX, SONGS, renderSfx, renderSong } from './synth';

/** Renders every SFX, then each song, posting results as they finish (buffers are transferred). */
self.onmessage = (e: MessageEvent<{ sfxRate: number; musicRate: number }>) => {
  const { sfxRate, musicRate } = e.data;
  const sfx: Record<string, Float32Array> = {};
  for (const id of Object.keys(SFX)) sfx[id] = renderSfx(SFX[id].tones, sfxRate, SFX[id].fx);
  (self as unknown as Worker).postMessage({ kind: 'sfx', sfx }, Object.values(sfx).map((a) => a.buffer));
  SONGS.forEach((s, i) => {
    const [l, r] = renderSong(s, musicRate);
    (self as unknown as Worker).postMessage({ kind: 'song', index: i, l, r }, [l.buffer, r.buffer]);
  });
};
