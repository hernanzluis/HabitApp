#!/usr/bin/env node
// Batería completa de tests de backend: ejecuta tests/test-NN-*.js en orden,
// N rondas (2 por defecto, el criterio de workflow.md para cambios de
// policies), con pausas entre fases para no chocar con los límites de Auth
// de Supabase por IP. Imprime una línea por fase con su resumen y termina con
// código 1 si alguna falla.
//
//   node scripts/run-tests.js            # 2 rondas, 60 s entre fases
//   node scripts/run-tests.js 1 20       # 1 ronda, 20 s entre fases
//
// Antes vivía como script temporal fuera del repo y se perdió (auditoría
// 2026-10-09, TS1).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rounds = Number(process.argv[2] || 2);
const pauseMs = Number(process.argv[3] || 60) * 1000;
const repo = path.resolve(__dirname, '..');
const dir = path.join(repo, 'tests');
const files = fs.readdirSync(dir).filter((f) => /^test-[0-9][0-9]-.*\.js$/.test(f)).sort();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let failed = 0;
const totals = [];
for (let round = 1; round <= rounds; round++) {
  let pass = 0, all = 0;
  console.log(`==== Ronda ${round} de ${rounds} ====`);
  files.forEach((f, i) => {
    if (round > 1 || i > 0) sleep(pauseMs);
    const t0 = Date.now();
    const r = spawnSync('node', [path.join(dir, f)], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = out.match(/== Resumen: (\d+)\/(\d+) pasaron ==/);
    if (m) { pass += Number(m[1]); all += Number(m[2]); }
    console.log(`---- ${f} (${Math.round((Date.now() - t0) / 1000)}s, exit ${r.status})`);
    console.log(out.split('\n').filter((l) => /== Resumen|ERROR FATAL|✗/.test(l)).join('\n') || '(sin resumen)');
    if (r.status !== 0) failed++;
  });
  totals.push(`${pass}/${all}`);
}
console.log(`\nTotales por ronda: ${totals.join(' · ')} | fases con fallos: ${failed}`);
process.exitCode = failed ? 1 : 0;
