import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMM, serializeMM, layout, renderSVG } from '../../renv/projects/freemind-web-canvas/src/freemind-core.mjs';
import { createGraphStorage } from '../src/storage/index.mjs';
import { saveTreeToGraph, loadTreeFromGraph } from '../src/converter/graph-tree.mjs';
import { formatOutlinerTree } from '../src/formatter/tree-view.mjs';
import { renderCanvas, canvasLines, findCanvasNeighbor } from '../src/formatter/map-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test_mindmaps.db');

async function runTests() {
  console.log('🧪 Memulai pengujian Freeplane CLI & Graph Engine...\n');

  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // 1. Storage initialization
  const storage = await createGraphStorage({ type: 'sqlite', dbPath: testDbPath });
  assert.ok(storage, 'Storage harus berhasil diinisialisasi');
  console.log('✔ 1. Inisialisasi SQLite Graph Adapter & Schema lulus');

  // 2. Import sample.mm into Graph
  const samplePath = path.resolve(__dirname, '../../renv/projects/freemind-web-canvas/src/sample.mm');
  const xml = fs.readFileSync(samplePath, 'utf8');
  const originalRoot = parseMM(xml);

  const importResult = await saveTreeToGraph(storage, 'test_map', 'Test Map', originalRoot);
  assert.strictEqual(importResult.mapId, 'test_map');
  assert.strictEqual(importResult.nodeCount, 12, 'Harus ada 12 nodes di sample.mm');
  assert.strictEqual(importResult.edgeCount, 11, 'Harus ada 11 edges di sample.mm');
  console.log('✔ 2. Impor .mm ke Graph (12 nodes, 11 edges) lulus');

  // 3. Rehydrate graph back to tree
  const { map, root: rehydratedRoot } = await loadTreeFromGraph(storage, 'test_map');
  assert.strictEqual(map.title, 'Test Map');
  assert.strictEqual(rehydratedRoot.text, 'FreeMind Web Canvas');
  assert.strictEqual(rehydratedRoot.children.length, 3, 'Root harus memiliki 3 cabang utama');
  console.log('✔ 3. Rehidrasi Graf ke In-Memory Tree lulus');

  // 4. Roundtrip serialization to .mm XML
  const roundtripXml = serializeMM(rehydratedRoot);
  const reParsed = parseMM(roundtripXml);
  assert.strictEqual(reParsed.text, originalRoot.text);
  assert.strictEqual(reParsed.children.length, originalRoot.children.length);
  console.log('✔ 4. Roundtrip XML .mm Serialization lulus');

  // 5. Outliner Tree view formatting
  const outlinerText = formatOutlinerTree(rehydratedRoot, { useColors: false });
  assert.ok(outlinerText.includes('FreeMind Web Canvas'));
  assert.ok(outlinerText.includes('Renderer'));
  assert.ok(outlinerText.includes('Model'));
  assert.ok(outlinerText.includes('Interaksi'));
  assert.ok(outlinerText.includes('Total: 11 nodes ditampilkan (1 terlipat).'));
  console.log('✔ 5. Formatter Outliner Tree View lulus');

  // 6. Graph Neighborhood Traversal (k-hop)
  const nh = await storage.getNeighborhood('n-renderer', 1);
  assert.ok(nh.length >= 4, 'Neighborhood 1-hop dari n-renderer harus menemukan root dan 3 children');
  const hasCanvas = nh.some(n => n.text === 'Canvas 2D' && n.hop === 1);
  assert.ok(hasCanvas, 'Hop 1 harus mendeteksi anak Canvas 2D');
  console.log('✔ 6. Graph Neighborhood (k-hop) Query lulus');

  // 7. Shortest Path Finding
  // Path between n-renderer and n-model (via root)
  const pathRes = await storage.findPath('n-renderer', 'n-model', 10);
  assert.ok(pathRes, 'Harus menemukan jalur antara n-renderer dan n-model');
  assert.strictEqual(pathRes.hop, 2, 'Jarak terpendek n-renderer -> root -> n-model harus 2 hop');
  console.log(`✔ 7. Shortest Path Reasoning (${pathRes.path}) lulus`);

  // 8. Full-Text Search (FTS5)
  const searchRes = await storage.search('Canvas', 'test_map');
  assert.ok(searchRes.length >= 2, 'Harus menemukan minimal 2 node dengan kata Canvas');
  console.log('✔ 8. FTS5 Full-Text Search lulus');

  // 9. Node Mutation (Add, Edit, Delete)
  const createdMap = await storage.createMap({
    id: 'map_test_create',
    title: 'Peta Uji Baru',
    root_id: 'root_test'
  });
  assert.strictEqual(createdMap.title, 'Peta Uji Baru');

  const newNode = await storage.addNode({
    id: 'node_test_add',
    map_id: 'test_map',
    text: 'Fitur Baru Ditambahkan'
  });
  assert.strictEqual(newNode.text, 'Fitur Baru Ditambahkan');

  await storage.updateNode('node_test_add', { text: 'Fitur Diedit' });
  const updatedNode = await storage.getNode('node_test_add');
  assert.strictEqual(updatedNode.text, 'Fitur Diedit');

  await storage.deleteNode('node_test_add');
  const deletedNode = await storage.getNode('node_test_add');
  assert.strictEqual(deletedNode, null);
  console.log('✔ 9. Operasi Mutasi Node (Add/Edit/Delete) lulus');

  // 10. Headless SVG Export
  layout(rehydratedRoot);
  const svg = renderSVG(rehydratedRoot);
  assert.ok(svg.startsWith('<svg'), 'SVG harus valid');
  assert.ok(svg.includes('FreeMind Web Canvas'), 'SVG harus berisi judul peta');
  assert.ok(!svg.includes('viewBox="NaN'), 'viewBox tidak boleh NaN');
  console.log('✔ 10. Headless SVG Rendering dari Graf lulus');

  // 11. Canvas 2D terminal (layout ke kanan, cabang atas/tengah/bawah)
  const canvasRoot = parseMM(`<map><node TEXT="Root">
    <node TEXT="Atas"><node TEXT="A1"/><node TEXT="A2"/></node>
    <node TEXT="Tengah"/>
    <node TEXT="Bawah"/>
  </node></map>`);
  const canvas = renderCanvas(canvasRoot, { color: false });
  assert.strictEqual(canvasRoot._canvasX, 0, 'Root harus di kolom paling kiri');
  assert.ok(canvasRoot.children[0]._canvasY < canvasRoot._canvasY, 'Anak pertama harus di atas root');
  assert.strictEqual(canvasRoot.children[1]._canvasY, canvasRoot._canvasY, 'Anak kedua harus sejajar root (tengah)');
  assert.ok(canvasRoot.children[2]._canvasY > canvasRoot._canvasY, 'Anak ketiga harus di bawah root');
  const canvasText = canvasLines(canvas, { color: false }).join('\n');
  assert.ok(canvasText.includes('[ Root ]'), 'Canvas harus menampilkan root');
  assert.ok(canvasText.includes('[ Tengah ]'), 'Canvas harus menampilkan cabang tengah');
  assert.ok(/[┌└├┼]/.test(canvasText), 'Canvas harus memakai karakter konektor box-drawing');
  assert.ok(findCanvasNeighbor(canvas, canvasRoot, 0, 1), 'Navigasi spasial canvas harus menemukan tetangga');
  const a1Node = canvasRoot.children[0].children[0];
  const a2Node = canvasRoot.children[0].children[1];
  const atasNode = canvasRoot.children[0];
  assert.strictEqual(findCanvasNeighbor(canvas, a1Node, 0, 1), a2Node, 'Navigasi DOWN dari A1 harus tepat ke A2');
  assert.strictEqual(findCanvasNeighbor(canvas, a2Node, 0, -1), a1Node, 'Navigasi UP dari A2 harus tepat ke A1');
  assert.strictEqual(findCanvasNeighbor(canvas, a1Node, -1, 0), atasNode, 'Navigasi LEFT dari A1 harus ke induk Atas');
  console.log('✔ 11. Canvas 2D Terminal (layout kanan, atas/tengah/bawah) lulus');

  await storage.close();
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  console.log('\n🎉 SEMUA 11 PENGUJIAN LULUS DENGAN SUKSES! (11/11 OK)\n');
}

runTests().catch(err => {
  console.error('❌ Gagal dalam pengujian:', err);
  process.exit(1);
});
