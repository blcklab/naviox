import { performance } from 'node:perf_hooks';
import { createNaviox, rankItems } from '../dist/index.js';

// Reproducible input and no dependency on shell tools. Results depend on hardware.
const samples = [1_000, 10_000];
const rounds = Number(process.env.NAVIOX_BENCH_ROUNDS || 8);
const enforce = process.argv.includes('--check');
const budgets = { 1000: Number(process.env.NAVIOX_BUDGET_1K_MS ?? 60), 10000: Number(process.env.NAVIOX_BUDGET_10K_MS ?? 450) };
const format = (n) => n.toFixed(2);
let failed = false;
for (const n of samples) {
  const source = Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`, title: `Document ${i}: Project architecture`,
    description: `Reference ${i % 17} and keyboard workflows`,
    keywords: [`topic-${i % 83}`, 'portfolio'],
  }));
  const timings = [];
  for (let trial = 0; trial < rounds + 2; trial++) {
    const start = performance.now();
    const results = rankItems(source, 'project architecture', 50);
    const ms = performance.now() - start;
    if (!results.length) throw new Error('Benchmark returned no results');
    if (trial >= 2) timings.push(ms);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  console.log(`rankItems(${n.toLocaleString()}): median ${format(median)} ms, min ${format(timings[0])} ms, budget ${budgets[n]} ms`);
  if (enforce && median > budgets[n]) failed = true;
  const nav = createNaviox(source, { maxResults: 50 });
  const start = performance.now();
  nav.setQuery('architecture');
  const controllerMs = performance.now() - start;
  console.log(`controller.setQuery(${n.toLocaleString()}): ${format(controllerMs)} ms`);
  if (nav.getState().results.length !== 50) throw new Error('Unexpected controller result count');
  nav.destroy();
}
const memory = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Node heap used after benchmark: ${format(memory)} MiB (not a leak measurement)`);
if (failed) {
  console.error('Search median exceeded the opt-in performance gate. Check hardware and regression history.');
  process.exitCode = 1;
}
