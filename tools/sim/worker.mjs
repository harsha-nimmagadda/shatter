import { parentPort, workerData } from 'node:worker_threads';

const sim = await import(workerData.bundle);
const cases = workerData.cases;

parentPort.on('message', (msg) => {
  if (msg.type === 'stop') {
    process.exit(0);
  }
  const out = [];
  for (const [ci, seed] of msg.tasks) out.push([ci, seed, sim.runCase(cases[ci], seed)]);
  parentPort.postMessage({ type: 'done', out });
});
parentPort.postMessage({ type: 'ready' });
