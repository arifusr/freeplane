// Uji round-trip parser/emitter .mm + sanity layout, termasuk atas file .mm asli FreeMind.
// Jalankan: node test/roundtrip.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMM, serializeMM, layout, boundingBox, visibleNodes, clone } from '../src/freemind-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.FREEMIND_SRC || '/home/arifusr/research/freemind-src';

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failures++; } };

// Bentuk ternormalisasi untuk perbandingan struktural.
const norm = (v) => (v === undefined ? null : v);
function shape(n) {
  const e = n.edge || { style: 'bezier', color: null, width: 1 };
  return {
    text: n.text, position: n.position, folded: n.folded, style: n.style,
    color: n.color, bg: n.bg, hGap: n.hGap, vGap: n.vGap, shiftY: n.shiftY,
    edge: [e.style || 'bezier', e.color || null, e.width || 1],
    cloud: n.cloud ? (n.cloud.color || null) : null,
    arrowlinks: n.arrowlinks.map((a) => [a.destination, a.color, a.startArrow, a.endArrow,
      a.startInclination ? [a.startInclination.x, a.startInclination.y] : null,
      a.endInclination ? [a.endInclination.x, a.endInclination.y] : null]),
    font: n.font ? [n.font.name, n.font.size, n.font.bold, n.font.italic, n.font.underline] : null,
    icons: n.icons.slice(),
    rich: norm(n.rich), note: norm(n.note),
    children: n.children.map(shape),
  };
}

function allFinite(root) {
  for (const n of visibleNodes(root)) {
    if (![n._contentX, n._contentY, n._w, n._h].every(Number.isFinite)) return false;
  }
  return true;
}

// ---- 1) contoh internal ----
const sample = readFileSync(join(here, '..', 'src', 'sample.mm'), 'utf8');
const r0 = parseMM(sample);
check(r0 && r0.text === 'FreeMind Web Canvas', 'teks root contoh');
check(r0.children.length === 3, 'root contoh punya 3 anak');
check(r0.children[1].position === 'left', 'Model di kiri');
check(r0.children[1].children[0].folded === true, 'Node tree folded');
check(r0.arrowlinks.length === 1, 'arrowlink contoh terbaca');
check(r0.arrowlinks[0].startInclination.x === 30, 'inklinasi arrowlink terbaca');
check(r0.children[1].cloud && r0.children[1].cloud.color === '#ffff33', 'cloud contoh terbaca');
check(JSON.stringify(shape(r0)) === JSON.stringify(shape(parseMM(serializeMM(r0)))), 'round-trip contoh identik');
layout(r0);
check(allFinite(r0), 'layout contoh finite');

// ---- 2) file .mm asli FreeMind ----
function findMM(dir) {
  const out = [];
  (function rec(d) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const p = join(d, ent.name);
      if (ent.isDirectory()) rec(p);
      else if (ent.name.endsWith('.mm')) out.push(p);
    }
  })(dir);
  return out;
}

let files_total = 0, files_parsed = 0, files_shape_ok = 0, files_layout_finite = 0, files_failed = 0;
let total_nodes_parsed = 0, arrows_total = 0, clouds_total = 0;
let firstError = null;
for (const f of findMM(SRC)) {
  files_total++;
  try {
    const root = parseMM(readFileSync(f, 'utf8'));
    if (!root) { files_failed++; continue; }
    files_parsed++;
    total_nodes_parsed += count(root);
    for (const n of (function rec(x, acc) { acc.push(x); for (const c of x.children) rec(c, acc); return acc; })(root, [])) {
      arrows_total += n.arrowlinks.length;
      if (n.cloud) clouds_total++;
    }
    const same = JSON.stringify(shape(root)) === JSON.stringify(shape(parseMM(serializeMM(root))));
    if (same) files_shape_ok++; else if (!firstError) firstError = `shape: ${f}`;
    layout(root);
    if (allFinite(root)) files_layout_finite++; else if (!firstError) firstError = `layout: ${f}`;
  } catch (e) {
    files_failed++;
    if (!firstError) firstError = `${f}: ${e.message}`;
  }
}

check(files_failed === 0, `semua .mm terparse tanpa error (${firstError || ''})`);
check(files_shape_ok === files_parsed, `semua .mm round-trip stabil (${firstError || ''})`);
check(files_layout_finite === files_parsed, `semua .mm layout finite (${firstError || ''})`);

// ---- util ----
function count(n) { return 1 + n.children.reduce((s, c) => s + count(c), 0); }

const metrics = {
  sample_roundtrip_ok: 1,
  nodes_total: count(r0),
  nodes_visible: visibleNodes(r0).length,
  files_total, files_parsed, files_shape_ok, files_layout_finite, files_failed,
  total_nodes_parsed, arrows_total, clouds_total,
  failures,
};
console.log(JSON.stringify(metrics));
process.exit(failures === 0 ? 0 : 1);
