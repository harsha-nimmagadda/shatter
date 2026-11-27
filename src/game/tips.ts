export type ControlMode = 'tilt' | 'drag' | 'stick';

interface Tip {
  text: string;
  /** Only shown to players steering this way. */
  mode?: ControlMode;
}

export const TIPS: readonly Tip[] = [
  { text: 'Catch the glowing capsules. Gold stars are worth chasing.' },
  { text: 'Red spiky capsules are bad news. Let them fall past.' },
  { text: 'Hit the ball with the paddle edge to steer where it goes.' },
  { text: 'Break bricks in one rally to climb the combo multiplier.' },
  { text: 'Keep a life in reserve: every life left is +250 points on a win.' },
  { text: 'Bomb bricks set off their neighbours. Aim for the middle of a cluster.' },
  { text: 'Metal clips come loose after enough hits. Keep rallying.' },
  { text: 'Tilt feels off? Calibrate it in Settings, Controls.', mode: 'tilt' },
  { text: 'Tilt too twitchy? Lower tilt sensitivity in Settings.', mode: 'tilt' },
  { text: 'Prefer to hold the phone still? Try STICK in Settings.', mode: 'tilt' },
  { text: 'In STICK mode, hold anywhere and push the knob. Tap to launch.', mode: 'stick' },
  { text: 'STICK too slow or fast? Change stick speed in Settings.', mode: 'stick' },
  { text: 'Drag anywhere. The paddle follows how far you slide.', mode: 'drag' },
  { text: 'Slide faster than the ball and you will always catch it.', mode: 'drag' },
];

/** Pure: the tips that apply to a control mode (mode-less tips always do). */
export const tipsFor = (mode: ControlMode): readonly string[] => TIPS.filter((t) => !t.mode || t.mode === mode).map((t) => t.text);

/** Pure: picks a tip using r in [0, 1). */
export function pickTip(mode: ControlMode, r: number): string {
  const list = tipsFor(mode);
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))];
}
