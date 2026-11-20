import './style.css';
import { View, LOGICAL_W, LOGICAL_H } from './game/view';
import { Loop } from './game/loop';
import { enterImmersive } from './game/fullscreen';

// Placeholder demo: a bouncing ball over ruled paper and a paddle. Proves the loop and scaling.
const BALL_R = 8;
const BALL_SPEED = 360;
const PADDLE = { x: 210, y: LOGICAL_H - 80, w: 120, h: 16 };

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas not supported');

const view = new View(canvas);

const ball = { x: 200, y: 400, vx: BALL_SPEED * 0.6, vy: -BALL_SPEED * 0.8 };
let prevX = ball.x;
let prevY = ball.y;

function update(dt: number): void {
  prevX = ball.x;
  prevY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < BALL_R) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x > LOGICAL_W - BALL_R) {
    ball.x = LOGICAL_W - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y < BALL_R) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y > LOGICAL_H - BALL_R) {
    ball.y = LOGICAL_H - BALL_R;
    ball.vy = -Math.abs(ball.vy);
  }
}

function render(alpha: number): void {
  const c = ctx as CanvasRenderingContext2D;
  view.begin(c);

  // Paper playfield.
  c.fillStyle = '#fffdf6';
  c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Faint blue ruled lines every 32 units.
  c.strokeStyle = 'rgba(60, 110, 200, 0.25)';
  c.lineWidth = 1;
  c.beginPath();
  for (let y = 32; y < LOGICAL_H; y += 32) {
    c.moveTo(0, y + 0.5);
    c.lineTo(LOGICAL_W, y + 0.5);
  }
  c.stroke();

  // Red margin line.
  c.strokeStyle = 'rgba(200, 60, 60, 0.6)';
  c.beginPath();
  c.moveTo(60.5, 0);
  c.lineTo(60.5, LOGICAL_H);
  c.stroke();

  // Paddle.
  c.fillStyle = '#2b2b2b';
  c.fillRect(PADDLE.x, PADDLE.y, PADDLE.w, PADDLE.h);

  // Ball, interpolated between the last two fixed steps.
  const bx = prevX + (ball.x - prevX) * alpha;
  const by = prevY + (ball.y - prevY) * alpha;
  c.fillStyle = '#1d3f8f';
  c.beginPath();
  c.arc(bx, by, BALL_R, 0, Math.PI * 2);
  c.fill();
}

const loop = new Loop(update, render);
loop.start();

canvas.addEventListener('pointerdown', () => void enterImmersive(), { once: true });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
