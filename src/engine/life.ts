import { CONFIG as C } from './config';
import { applyPaddleWidth } from './paddle';
import { newStuckBall, type World } from './state';

/** Costs a life: clears drops, bolts, timed effects, combo, clip streak and the net; serves again or ends the game. */
export function loseLife(w: World): void {
  w.lives -= 1;
  w.speed = C.startSpeed;
  w.drops = [];
  w.bolts = [];
  w.effects = {};
  w.combo = 0;
  w.clipStreak = 0;
  for (const k of w.bricks) k.streakHits = 0;
  w.net = false;
  w.stapleCd = 0;
  applyPaddleWidth(w);
  w.events.push({ type: 'lifeLost', x: w.paddle.x, y: w.height });
  if (w.lives <= 0) {
    w.balls = [];
    w.status = 'gameover';
    w.events.push({ type: 'gameover', x: w.paddle.x, y: w.height });
  } else {
    w.status = 'serve';
    const ball = newStuckBall();
    ball.x = w.paddle.x;
    ball.y = w.paddle.y - ball.r;
    w.balls = [ball];
  }
}
