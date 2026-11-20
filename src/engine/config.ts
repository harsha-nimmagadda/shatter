/** All gameplay tunables. Units are logical playfield units (540 x 960) and seconds. */
export const CONFIG = {
  width: 540,
  height: 960,
  /** Y of the top wall (room above for the HUD). Side walls are the playfield edges. */
  topWall: 64,
  paddleW: 96,
  paddleH: 16,
  paddleY: 960 - 90,
  paddleMaxSpeed: 2400,
  paddleKeySpeed: 700,
  ballR: 8,
  startSpeed: 420,
  /** Fractional speed gain per brick break. */
  speedGain: 0.015,
  maxSpeed: 1000,
  /** Max paddle bounce angle from vertical, degrees. */
  maxBounceDeg: 60,
  /** Launch angle spread from vertical, degrees. */
  launchDeg: 20,
  /** Minimum |vy| / speed after a bounce, so the ball never runs flat. */
  minVerticalRatio: 0.3,
  lives: 3,
  brickScore: 10,
} as const;
