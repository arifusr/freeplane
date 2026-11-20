#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseMM, serializeMM, layout, renderSVG } from '../../renv/projects/freemind-web-canvas/src/freemind-core.mjs';
import { createGraphStorage } from '../src/storage/index.mjs';
import { saveTreeToGraph, loadTreeFromGraph } from '../src/converter/graph-tree.mjs';
import { formatOutlinerTree } from '../src/formatter/tree-view.mjs';
import { renderCanvas, canvasLines } from '../src/formatter/map-canvas.mjs';
import { render2DSpatialMap } from '../src/formatter/map-2d.mjs';
import { runInteractiveTUI } from '../src/tui/interactive.mjs';

const HELP_TEXT = `
🧠 Freeplane CLI & Graph Engine (LadybugDB / SQLite)

Penggunaan:
  fmap map list                         Daftar seluruh peta yang tersimpan
  fmap map create <title> [--root text] Buat mindmap baru dengan root default
  fmap map import <file.mm> [-t title]  Impor file .mm ke database graf
  fmap map export <map_id> -o <file>    Ekspor peta ke format .mm, .svg, atau .json
  fmap map delete <map_id>              Hapus peta dari database

  fmap view <map_id> [--depth N]        Tampilkan pohon hierarki (Outliner) di terminal
  fmap canvas <map_id> [--ascii]        Tampilkan mindmap 2D di terminal (gaya DOS)
  fmap ui <map_id> [--canvas] [--ascii] Buka Interactive TUI (v = Canvas 2D)

  fmap search "<query>" [--map map_id]  Pencarian teks & catatan via FTS
  fmap context <node_id> [--hops N]     Ambil subgraf sekitar node untuk AI Agent (JSON)
  fmap path <node_a> <node_b>           Cari jalur koneksi terpendek antara dua node
  fmap cypher "<query>"                 Jalankan kueri graf Cypher

  fmap node add <map_id> <parent_id> "Teks"  Tambah cabang baru
  fmap node edit <map_id> <node_id> "Teks"   Ubah teks cabang
  fmap node rm <map_id> <node_id>            Hapus cabang

Opsi Global:
  --db <path>       Lokasi file database (default: ./mindmaps.lbug atau ./mindmaps.db)
  --engine <type>   Engine graf: 'auto' (default: LadybugDB jika ada, fallback ke SQLite), 'ladybug', atau 'sqlite'
  -h, --help        Tampilkan bantuan ini
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(HELP_TEXT);
    return;
  }

  // Extract global options
  let dbPath = null;
  let engine = 'auto';

  const cleanArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = args[++i];
    } else if (args[i] === '--engine' && args[i + 1]) {
      engine = args[++i];
    } else {
      cleanArgs.push(args[i]);
    }
  }

  const storage = await createGraphStorage({ type: engine, dbPath });

  try {
    let cmd = cleanArgs[0];
    let subcmd = cleanArgs[1];

    if (cmd === 'create' || cmd === 'new') {
      subcmd = cmd;
      cmd = 'map';
      cleanArgs.splice(0, 0, 'map');
    }

    const asJson = cleanArgs.includes('--json');

    // ==========================================
    // MAP COMMANDS
    // ==========================================
    if (cmd === 'map') {
      if (subcmd === 'list') {
        const maps = await storage.listMaps();
        if (asJson) {
          console.log(JSON.stringify(maps, null, 2));
          return;
        }
        if (maps.length === 0) {
          console.log('\nBelum ada peta di database graf. Gunakan: fmap map import <file.mm>');
          return;
        }
        console.log(`\n📋 Daftar Peta (${maps.length} peta tersimpan):`);
        console.log('─'.repeat(60));
        for (const m of maps) {
          console.log(`• [${m.id}] \x1b[1;36m${m.title}\x1b[0m (${m.node_count} nodes, ${m.edge_count} edges) - Update: ${m.updated_at}`);
        }
        console.log('');
      } else if (subcmd === 'create' || subcmd === 'new') {
        const title = cleanArgs[2];
        if (!title) {
          console.error('Error: Masukkan judul peta. Contoh: fmap map create "Rencana Projek"');
          process.exit(1);
        }
        let rootText = title;
        const rIdx = cleanArgs.indexOf('--root');
        if (rIdx !== -1 && cleanArgs[rIdx + 1]) {
          rootText = cleanArgs[rIdx + 1];
        }

        const mapId = 'map_' + Date.now().toString(36);
        const rootId = 'ID_' + Date.now().toString(36) + '_root';

        await storage.createMap({
          id: mapId,
          title,
          root_id: rootId
        });

        await storage.addNode({
          id: rootId,
          map_id: mapId,
          text: rootText,
          note: null
        });

        if (asJson) {
          console.log(JSON.stringify({ success: true, mapId, rootId, title }, null, 2));
          return;
        }

        console.log(`\x1b[32m✔ Peta baru berhasil dibuat!\x1b[0m`);
        console.log(`  ID Peta   : \x1b[1;33m${mapId}\x1b[0m`);
        console.log(`  Judul     : \x1b[1;36m${title}\x1b[0m`);
        console.log(`  Root Node : [${rootId}] "${rootText}"`);
        console.log(`\nLangkah selanjutnya:`);
        console.log(`• Buka di TUI interaktif : \x1b[33mfmap ui ${mapId}\x1b[0m`);
        console.log(`• Tambah cabang via CLI  : \x1b[33mfmap node add ${mapId} ${rootId} "Cabang Pertama"\x1b[0m`);
        console.log(`• Tampilkan pohon        : \x1b[33mfmap view ${mapId}\x1b[0m\n`);
      } else if (subcmd === 'import') {
        const filePath = cleanArgs[2];
        if (!filePath) {
          console.error('Error: Masukkan path file .mm. Contoh: fmap map import file.mm');
          process.exit(1);
        }
        let title = path.basename(filePath, path.extname(filePath));
        const tIdx = cleanArgs.indexOf('-t');
        if (tIdx !== -1 && cleanArgs[tIdx + 1]) title = cleanArgs[tIdx + 1];

        const xml = fs.readFileSync(filePath, 'utf8');
        const rootNode = parseMM(xml);
        const mapId = 'map_' + Date.now().toString(36);

        console.log(`Mengimpor '${filePath}' ke database graf...`);
        const res = await saveTreeToGraph(storage, mapId, title, rootNode);
        console.log(`\x1b[32m✔ Peta berhasil diimpor!\x1b[0m ID: \x1b[1;33m${res.mapId}\x1b[0m (${res.nodeCount} nodes, ${res.edgeCount} edges).`);
      } else if (subcmd === 'export') {
        const mapId = cleanArgs[2];
        const outIdx = cleanArgs.indexOf('-o');
        const outPath = outIdx !== -1 ? cleanArgs[outIdx + 1] : null;

        if (!mapId || !outPath) {
          console.error('Error: Format ekspor salah. Contoh: fmap map export <map_id> -o out.mm');
          process.exit(1);
        }

        const { root } = await loadTreeFromGraph(storage, mapId);
        const ext = path.extname(outPath).toLowerCase();

        if (ext === '.svg') {
          layout(root);
          const svg = renderSVG(root);
          fs.writeFileSync(outPath, svg, 'utf8');
          console.log(`\x1b[32m✔ Berhasil diekspor ke SVG:\x1b[0m ${outPath}`);
        } else if (ext === '.json') {
          fs.writeFileSync(outPath, JSON.stringify(root, null, 2), 'utf8');
          console.log(`\x1b[32m✔ Berhasil diekspor ke JSON:\x1b[0m ${outPath}`);
        } else {
          // Default .mm XML
          const xml = serializeMM(root);
          fs.writeFileSync(outPath, xml, 'utf8');
          console.log(`\x1b[32m✔ Berhasil diekspor ke FreeMind XML (.mm):\x1b[0m ${outPath}`);
        }
      } else if (subcmd === 'delete') {
        const mapId = cleanArgs[2];
        if (!mapId) {
          console.error('Error: Masukkan ID peta yang ingin dihapus.');
          process.exit(1);
        }
        await storage.deleteMap(mapId);
        console.log(`\x1b[32m✔ Peta '${mapId}' berhasil dihapus.\x1b[0m`);
      } else {
        console.log(`Perintah map tidak dikenal: ${subcmd}`);
      }
      return;
    }

    // ==========================================
    // VIEW COMMAND (OUTLINER)
    // ==========================================
    if (cmd === 'view') {
      const mapId = cleanArgs[1];
      if (!mapId) {
        console.error('Error: Masukkan ID peta. Contoh: fmap view <map_id>');
        process.exit(1);
      }
      let maxDepth = 99;
      const depthIdx = cleanArgs.indexOf('--depth');
      if (depthIdx !== -1 && cleanArgs[depthIdx + 1]) {
        maxDepth = parseInt(cleanArgs[depthIdx + 1], 10);
      }

      const { root } = await loadTreeFromGraph(storage, mapId);
      if (asJson) {
        console.log(JSON.stringify(root, null, 2));
        return;
      }
      console.log('\n' + formatOutlinerTree(root, { maxDepth }));
      return;
    }

    // ==========================================
    // CANVAS COMMAND (MINDMAP 2D DI TERMINAL)
    // ==========================================
    if (cmd === 'canvas' || cmd === 'map2d' || cmd === 'view2d') {
      const mapId = cleanArgs[1];
      if (!mapId) {
        console.error('Error: Masukkan ID peta. Contoh: fmap canvas <map_id> [--vertical]');
        process.exit(1);
      }
      const ascii = cleanArgs.includes('--ascii');
      const noColor = cleanArgs.includes('--no-color');
      const isVertical = cleanArgs.includes('--vertical') || cleanArgs.includes('--radial') || cmd === 'view2d';

      let maxLabel = 40;
      const mlIdx = cleanArgs.indexOf('--max-label');
      if (mlIdx !== -1 && cleanArgs[mlIdx + 1]) {
        const v = parseInt(cleanArgs[mlIdx + 1], 10);
        if (Number.isFinite(v)) maxLabel = v;
      }

      const { map, root } = await loadTreeFromGraph(storage, mapId);

      if (isVertical) {
        let maxDepth = 2;
        const depthIdx = cleanArgs.indexOf('--depth');
        if (depthIdx !== -1 && cleanArgs[depthIdx + 1]) {
          maxDepth = parseInt(cleanArgs[depthIdx + 1], 10);
        }
        const str2d = render2DSpatialMap(root, { useColors: !noColor && Boolean(process.stdout.isTTY), maxDepth });
        console.log(`\n🧠 ${map.title} — 2D Spatial Map (Root di tengah, cabang atas & bawah)\n`);
        console.log(str2d);
        console.log('');
        return;
      }

      const grid = renderCanvas(root, { ascii, maxLabel });
      const lines = canvasLines(grid, { color: !noColor && Boolean(process.stdout.isTTY) });
      console.log(`\n🧠 ${map.title} — ${grid.nodes.length} node (layout kanan, cabang atas/bawah)\n`);
      console.log(lines.join('\n'));
      console.log('');
      return;
    }

    // ==========================================
    // UI COMMAND (INTERACTIVE TUI WINDOW)
    // ==========================================
    if (cmd === 'ui') {
      const mapId = cleanArgs[1] && !cleanArgs[1].startsWith('--') ? cleanArgs[1] : null;
      const tuiOptions = {
        view: cleanArgs.includes('--canvas') ? 'canvas' : 'outliner',
        ascii: cleanArgs.includes('--ascii')
      };
      if (!mapId) {
        // If not specified, pick the first map
        const maps = await storage.listMaps();
        if (maps.length === 0) {
          console.error('Belum ada peta. Impor dulu dengan: fmap map import <file.mm>');
          process.exit(1);
        }
        await runInteractiveTUI(storage, maps[0].id, tuiOptions);
      } else {
        await runInteractiveTUI(storage, mapId, tuiOptions);
      }
      return;
    }

    // ==========================================
    // SEARCH COMMAND
    // ==========================================
    if (cmd === 'search') {
      const query = cleanArgs[1];
      if (!query) {
        console.error('Error: Masukkan kata kunci pencarian. Contoh: fmap search "backend"');
        process.exit(1);
      }
      const results = await storage.search(query);
      if (asJson) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      console.log(`\n🔍 Hasil Pencarian untuk "${query}" (${results.length} ditemukan):`);
      console.log('─'.repeat(60));
      for (const r of results) {
        console.log(`• [${r.node_id}] Peta: \x1b[36m${r.map_title}\x1b[0m`);
        console.log(`  Teks   : ${r.text_snippet || r.text}`);
        if (r.note) console.log(`  Catatan: ${r.note_snippet || r.note}`);
        console.log('');
      }
      return;
    }

    // ==========================================
    // CONTEXT COMMAND (FOR AI AGENTS)
    // ==========================================
    if (cmd === 'context') {
      const nodeId = cleanArgs[1];
      if (!nodeId) {
        console.error('Error: Masukkan ID node. Contoh: fmap context ID_123 --hops 2');
        process.exit(1);
      }
      let hops = 2;
      const hopsIdx = cleanArgs.indexOf('--hops');
      if (hopsIdx !== -1 && cleanArgs[hopsIdx + 1]) {
        hops = parseInt(cleanArgs[hopsIdx + 1], 10);
      }
      const subgraf = await storage.getNeighborhood(nodeId, hops);
      console.log(JSON.stringify(subgraf, null, 2));
      return;
    }

    // ==========================================
    // PATH COMMAND
    // ==========================================
    if (cmd === 'path') {
      const nodeA = cleanArgs[1];
      const nodeB = cleanArgs[2];
      if (!nodeA || !nodeB) {
        console.error('Error: Masukkan 2 ID node. Contoh: fmap path ID_A ID_B');
        process.exit(1);
      }
      const res = await storage.findPath(nodeA, nodeB);
      if (asJson) {
        console.log(JSON.stringify(res || { found: false, nodeA, nodeB }, null, 2));
        return;
      }
      if (res) {
        console.log(`\n\x1b[32m✔ Jalur penalaran ditemukan (${res.hop} hops):\x1b[0m`);
        console.log(`  ${res.path}\n`);
      } else {
        console.log(`\n❌ Tidak ditemukan jalur antara ${nodeA} dan ${nodeB}.\n`);
      }
      return;
    }

    // ==========================================
    // CYPHER QUERY
    // ==========================================
    if (cmd === 'cypher') {
      const queryStr = cleanArgs[1];
      if (!queryStr) {
        console.error('Error: Masukkan string kueri graf.');
        process.exit(1);
      }
      const result = await storage.query(queryStr);
      console.log(asJson ? JSON.stringify(result, null, 2) : '\n📊 Hasil Kueri Graf:\n' + JSON.stringify(result, null, 2));
      return;
    }

    // ==========================================
    // NODE COMMANDS (MUTATION)
    // ==========================================
    if (cmd === 'node') {
      if (subcmd === 'add') {
        const mapId = cleanArgs[2];
        const parentId = cleanArgs[3];
        const text = cleanArgs[4];
        if (!mapId || !parentId || !text) {
          console.error('Contoh: fmap node add <map_id> <parent_id> "Teks Cabang"');
          process.exit(1);
        }
        const newId = 'ID_' + Date.now().toString(36);
        await storage.addNode({ id: newId, map_id: mapId, text });
        await storage.addEdge({ map_id: mapId, source: parentId, target: newId, type: 'PARENT_OF' });
        if (asJson) {
          console.log(JSON.stringify({ success: true, id: newId, mapId, parentId, text }, null, 2));
          return;
        }
        console.log(`\x1b[32m✔ Cabang baru berhasil dibuat!\x1b[0m ID: ${newId}`);
      } else if (subcmd === 'edit') {
        const mapId = cleanArgs[2];
        const nodeId = cleanArgs[3];
        const text = cleanArgs[4];
        if (!nodeId || !text) {
          console.error('Contoh: fmap node edit <map_id> <node_id> "Teks Baru"');
          process.exit(1);
        }
        await storage.updateNode(nodeId, { text });
        if (asJson) {
          console.log(JSON.stringify({ success: true, id: nodeId, mapId, text }, null, 2));
          return;
        }
        console.log(`\x1b[32m✔ Cabang ${nodeId} diperbarui.\x1b[0m`);
      } else if (subcmd === 'rm') {
        const mapId = cleanArgs[2];
        const nodeId = cleanArgs[3];
        if (!nodeId) {
          console.error('Contoh: fmap node rm <map_id> <node_id>');
          process.exit(1);
        }
        await storage.deleteNode(nodeId);
        if (asJson) {
          console.log(JSON.stringify({ success: true, id: nodeId, mapId }, null, 2));
          return;
        }
        console.log(`\x1b[32m✔ Cabang ${nodeId} dihapus.\x1b[0m`);
      } else if (subcmd === 'get' || subcmd === 'show') {
        const nodeId = cleanArgs[2];
        if (!nodeId) {
          console.error('Contoh: fmap node get <node_id> [--json]');
          process.exit(1);
        }
        const node = await storage.getNode(nodeId);
        if (!node) {
          console.error(`Node '${nodeId}' tidak ditemukan.`);
          process.exit(1);
        }
        if (asJson) {
          console.log(JSON.stringify(node, null, 2));
          return;
        }
        console.log(`\n📌 Detail Node [${node.id}]:`);
        console.log(`  Teks    : ${node.text}`);
        if (node.note) console.log(`  Catatan : ${node.note}`);
        console.log(`  Map ID  : ${node.map_id}`);
        console.log(`  Style   : ${node.style || 'default'}`);
        console.log(`  Folded  : ${node.folded ? 'Ya' : 'Tidak'}\n`);
      }
      return;
    }

    console.log(`Perintah tidak dikenal: ${cmd}. Jalankan 'fmap --help' untuk bantuan.`);
  } finally {
    await storage.close();
  }
}

main().catch(err => {
  console.error('\x1b[31mError:\x1b[0m', err.message);
  process.exit(1);
});
