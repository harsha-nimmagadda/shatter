#!/usr/bin/env node
// Headless autopilot simulator. Usage: npm run sim -- [--seeds 200] [--bots pro,casual,novice]
//   [--levels level1,explosive,...] [--powers natural,photocopy,...] [--out sim-results/<timestamp>]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'rolldown';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const bundlePath = path.join(here, '.build', 'sim.mjs');

function parseArgs(argv) {
  const opts = { seeds: 200, bots: undefined, levels: undefined, powers: undefined, out: undefined };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const val = () => inline ?? argv[++i];
    if (flag === '--seeds') opts.seeds = Number(val());
    else if (flag === '--bots') opts.bots = list(val());
    else if (flag === '--levels') opts.levels = list(val());
    else if (flag === '--powers') opts.powers = list(val());
    else if (flag === '--out') opts.out = val();
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(opts.seeds) || opts.seeds < 1) throw new Error('--seeds must be a positive integer');
  return opts;
}

const fmtTime = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  await build({
    input: path.join(root, 'src/sim/index.ts'),
    platform: 'node',
    logLevel: 'warn',
    output: { dir: path.join(here, '.build'), format: 'esm', entryFileNames: 'sim.mjs', sourcemap: false },
  });
  const sim = await import(pathToFileURL(bundlePath).href);

  const cases = sim.buildCases({ levels: args.levels, powers: args.powers, bots: args.bots });
  const tasks = [];
  for (let ci = 0; ci < cases.length; ci++) for (let s = 1; s <= args.seeds; s++) tasks.push([ci, s]);
  const total = tasks.length;
  const nWorkers = Math.max(1, Math.min(os.cpus().length - 1, Math.ceil(total / 4)));
  const chunk = Math.max(1, Math.min(25, Math.floor(total / (nWorkers * 8))));
  console.error(`sim: ${cases.length} cases x ${args.seeds} seeds = ${total} games on ${nWorkers} workers`);

  const outDir = path.resolve(root, args.out ?? path.join('sim-results', new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(outDir, { recursive: true });

  const results = [];
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  let lastPrint = 0;
  const progress = (final) => {
    const now = Date.now();
    if (!final && now - lastPrint < 500) return;
    lastPrint = now;
    const el = (now - t0) / 1000;
    const eta = done > 0 ? (el / done) * (total - done) : 0;
    process.stderr.write(`\r${done}/${total} (${((100 * done) / total).toFixed(1)}%) elapsed ${fmtTime(el)} ETA ${fmtTime(eta)}   ${final ? '\n' : ''}`);
  };

  await new Promise((resolve, reject) => {
    let alive = nWorkers;
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(path.join(here, 'worker.mjs'), { workerData: { bundle: pathToFileURL(bundlePath).href, cases } });
      const feed = () => {
        if (next >= total) {
          w.postMessage({ type: 'stop' });
          return;
        }
        const batch = tasks.slice(next, next + chunk);
        next += batch.length;
        w.postMessage({ type: 'tasks', tasks: batch });
      };
      w.on('message', (m) => {
        if (m.type === 'done') {
          for (const r of m.out) results.push(r);
          done += m.out.length;
          progress(false);
        }
        feed();
      });
      w.on('error', reject);
      w.on('exit', () => {
        if (--alive === 0) resolve();
      });
    }
  });
  progress(true);

  results.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const runs = results.map((r) => r[2]);
  writeFileSync(path.join(outDir, 'runs.csv'), [sim.csvHeader(), ...runs.map(sim.csvRow)].join('\n') + '\n');
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(sim.summarize(runs), null, 2) + '\n');
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) commit += '+dirty';
  } catch { /* not a git checkout */ }
  const wall = (Date.now() - started) / 1000;
  writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify({ commit, date: new Date().toISOString(), args: { ...args, argv: process.argv.slice(2) }, games: total, wallSeconds: Math.round(wall * 10) / 10, workers: nWorkers, config: sim.CONFIG }, null, 2) + '\n',
  );
  console.error('\ncalibration (per bot, all games in this run):');
  for (const bot of [...new Set(runs.map((r) => r.bot))]) {
    const rs = runs.filter((r) => r.bot === bot);
    const times = rs.map((r) => r.timeSec).sort((a, b) => a - b);
    const win = rs.filter((r) => r.outcome === 'won').length / rs.length;
    const lives = rs.reduce((a, r) => a + r.livesLost, 0) / rs.length;
    console.error(`  ${bot.padEnd(7)} games ${String(rs.length).padStart(6)}  win ${(win * 100).toFixed(1).padStart(5)}%  mean lives lost ${lives.toFixed(2)}  median time ${sim.percentile(times, 0.5).toFixed(1)}s`);
  }
  console.error(`sim: wrote ${outDir} (${total} games in ${fmtTime(wall)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
