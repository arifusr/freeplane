import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const cliDir = path.resolve(__dirname, '..');
const distDir = path.resolve(cliDir, 'dist');

console.log('🔨 Memulai proses build binary executable standalone...');

fs.mkdirSync(distDir, { recursive: true });

// 1. Baca source files
const freemindCoreSrc = fs.readFileSync(path.join(rootDir, 'renv/projects/freemind-web-canvas/src/freemind-core.mjs'), 'utf8');
const adapterSrc = fs.readFileSync(path.join(cliDir, 'src/storage/adapter.mjs'), 'utf8');
const sqliteAdapterSrc = fs.readFileSync(path.join(cliDir, 'src/storage/sqlite-graph-adapter.mjs'), 'utf8');
const ladybugAdapterSrc = fs.readFileSync(path.join(cliDir, 'src/storage/ladybug-adapter.mjs'), 'utf8');
const storageIndexSrc = fs.readFileSync(path.join(cliDir, 'src/storage/index.mjs'), 'utf8');
const graphTreeSrc = fs.readFileSync(path.join(cliDir, 'src/converter/graph-tree.mjs'), 'utf8');
const treeViewSrc = fs.readFileSync(path.join(cliDir, 'src/formatter/tree-view.mjs'), 'utf8');
const mapCanvasSrc = fs.readFileSync(path.join(cliDir, 'src/formatter/map-canvas.mjs'), 'utf8');
const map2dSrc = fs.readFileSync(path.join(cliDir, 'src/formatter/map-2d.mjs'), 'utf8');
const tuiSrc = fs.readFileSync(path.join(cliDir, 'src/tui/interactive.mjs'), 'utf8');
const fmapBinSrc = fs.readFileSync(path.join(cliDir, 'bin/fmap.mjs'), 'utf8');

function cleanModule(code) {
  return code
    .replace(/^#!.*$/m, '') // remove shebang
    .replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '') // remove ESM imports
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+(const|let|var|function|class|async\s+function)/g, '$1');
}

// 2. Gabungkan ke dalam satu file bundle CommonJS
const parts = [
  '// Standalone Freeplane CLI Bundle (Auto-generated)',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const readline = require('node:readline');",
  "const { DatabaseSync } = require('node:sqlite');",
  '',
  '// --- FREEMIND CORE ---',
  cleanModule(freemindCoreSrc),
  '',
  '// --- STORAGE ADAPTERS ---',
  cleanModule(adapterSrc),
  cleanModule(sqliteAdapterSrc),
  cleanModule(ladybugAdapterSrc),
  cleanModule(storageIndexSrc),
  '',
  '// --- GRAPH CONVERTER ---',
  cleanModule(graphTreeSrc),
  '',
  '// --- TREE VIEW FORMATTER ---',
  cleanModule(treeViewSrc),
  '',
  '// --- MAP CANVAS 2D (TERMINAL) ---',
  cleanModule(mapCanvasSrc),
  '',
  '// --- MAP 2D SPATIAL RADIAL ---',
  cleanModule(map2dSrc),
  '',
  '// --- INTERACTIVE TUI ---',
  cleanModule(tuiSrc),
  '',
  '// --- MAIN CLI CONTROLLER ---',
  cleanModule(fmapBinSrc)
];

const bundlePath = path.join(distDir, 'bundle.cjs');
fs.writeFileSync(bundlePath, parts.join('\n'), 'utf8');
console.log('✔ Bundle JS berhasil dibuat:', bundlePath);

// 3. Konfigurasi Node.js Single Executable Application (SEA)
const seaConfig = {
  main: bundlePath,
  output: path.join(distDir, 'fmap'),
  disableExperimentalSEAWarning: true
};

const seaConfigPath = path.join(distDir, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');

const outputBinary = path.join(distDir, 'fmap');
if (fs.existsSync(outputBinary)) {
  fs.unlinkSync(outputBinary);
}

// 4. Kompilasi ke binary ELF standalone menggunakan node --build-sea
console.log('⚡ Mengompilasi binary standalone dengan node --build-sea...');
execSync(`node --build-sea=${seaConfigPath}`, { stdio: 'inherit' });

// Berikan permission executable
fs.chmodSync(outputBinary, 0o755);

console.log(`\n🎉 SUKSES! Binary executable standalone telah dibuat di:\n👉 ${outputBinary}\n`);
