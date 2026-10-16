// Render sample.mm ke SVG (headless). Output: argv[2] atau $RENV_RUN_DIR/mindmap.svg.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMM, layout, renderSVG } from '../src/freemind-core.mjs';

const out = process.argv[2]
  || (process.env.RENV_RUN_DIR ? `${process.env.RENV_RUN_DIR}/mindmap.svg` : '/tmp/mindmap.svg');
const xml = readFileSync(fileURLToPath(new URL('../src/sample.mm', import.meta.url)), 'utf8');
const root = parseMM(xml);
layout(root);
const svg = renderSVG(root, { selectedNode: null });
writeFileSync(out, svg);

let nodes = 0;
(function rec(n) { nodes++; for (const c of n.children) rec(c); })(root);
console.log(JSON.stringify({ svg_bytes: svg.length, svg_nodes: nodes }));
