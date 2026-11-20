import { loadTreeFromGraph } from '../converter/graph-tree.mjs';
import { renderCanvas, canvasLines, findCanvasNeighbor } from '../formatter/map-canvas.mjs';

export async function runInteractiveTUI(storage, initialMapId, options = {}) {
  const asciiCanvas = !!options.ascii;
  let mapId = initialMapId;
  let { map, root } = await loadTreeFromGraph(storage, mapId);

  // Flatten visible nodes into an ordered list for navigation
  function getFlattenedVisibleList(node, depth = 0, parent = null) {
    const list = [{ node, depth, parent }];
    if (node.children && !node.folded) {
      for (const child of node.children) {
        list.push(...getFlattenedVisibleList(child, depth + 1, node));
      }
    }
    return list;
  }

  let flatList = getFlattenedVisibleList(root);
  let selectedIndex = 0;
  let statusMessage = 'Tekan [/] untuk command, [v] canvas 2D, [Tab] sub-cabang, [Enter] sibling, [e] edit, [q] keluar.';

  // Mode: 'NAV' (normal navigation) or 'INPUT' (command / typing in bottom bar)
  let mode = 'NAV';
  let inputBuffer = '';
  let cursorPosition = 0;

  // Tampilan: 'outliner' (daftar pohon) atau 'canvas' (mindmap 2D ala DOS).
  let viewMode = options.view === 'canvas' ? 'canvas' : 'outliner';
  let panX = 0, panY = 0;

  const stdout = process.stdout;
  const stdin = process.stdin;
  let watchTimer = null;

  // Setup terminal
  stdout.write('\x1b[?1049h'); // Alternate screen buffer
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
  }

  function cleanup() {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
    stdout.write('\x1b[?25h');   // Restore cursor
    stdout.write('\x1b[?1049l'); // Restore normal screen
    if (stdin.isTTY) {
      stdin.setRawMode(false);
      stdin.pause();
    }
  }

  async function reloadMap(newMapId = mapId) {
    const selectedId = flatList[selectedIndex]?.node?.id || null;
    mapId = newMapId;
    const updated = await loadTreeFromGraph(storage, mapId);
    map = updated.map;
    root = updated.root;
    flatList = getFlattenedVisibleList(root);
    const keptIndex = selectedId ? flatList.findIndex((it) => it.node.id === selectedId) : -1;
    if (keptIndex >= 0) selectedIndex = keptIndex;
    if (selectedIndex >= flatList.length) selectedIndex = Math.max(0, flatList.length - 1);
  }

  function render() {
    const cols = stdout.columns || 80;
    const rows = stdout.rows || 24;
    const leftWidth = Math.floor(cols * 0.58);
    const rightWidth = cols - leftWidth - 1;
    const contentHeight = Math.max(5, rows - 4); // reserve for header, status, command bar

    flatList = getFlattenedVisibleList(root);
    if (selectedIndex >= flatList.length) selectedIndex = Math.max(0, flatList.length - 1);

    const buffer = [];
    buffer.push('\x1b[H'); // Move to top-left

    // 1. Header (Row 1)
    const headerTitle = ` 🧠 Freeplane TUI: ${map.title} (${flatList.length} nodes) — ${viewMode === 'canvas' ? 'Canvas 2D' : 'Outliner'} `;
    buffer.push(`\x1b[1;37;44m${headerTitle.padEnd(cols, ' ')}\x1b[0m\n`);

    // 2. Pane kiri: outliner ATAU canvas 2D (mindmap ala DOS).
    let canvasGrid = null;
    const paneLines = [];
    if (viewMode === 'canvas') {
      canvasGrid = renderCanvas(root, { color: true, ascii: asciiCanvas });
      const selectedNode = flatList[selectedIndex]?.node || null;
      const vw = Math.max(10, leftWidth - 1);
      const vh = contentHeight;
      if (selectedNode) {
        const sx = selectedNode._canvasX, sw = selectedNode._canvasW, sy = selectedNode._canvasY;
        const maxPanX = Math.max(0, canvasGrid.width - vw);
        const maxPanY = Math.max(0, canvasGrid.height - vh);
        // Jaga node terpilih tetap terlihat; geser viewport bila perlu.
        if (sx < panX + 2) panX = Math.max(0, sx - 2);
        if (sx + sw > panX + vw - 2) panX = Math.max(0, Math.min(maxPanX, sx + sw + 2 - vw));
        if (sy < panY) panY = Math.max(0, sy - 1);
        if (sy >= panY + vh) panY = Math.max(0, Math.min(maxPanY, sy - vh + 2));
        panX = Math.max(0, Math.min(maxPanX, panX));
        panY = Math.max(0, Math.min(maxPanY, panY));
      }
      const lines = canvasLines(canvasGrid, {
        x0: panX, y0: panY, width: vw, height: vh,
        selected: selectedNode, color: true,
      });
      for (let i = 0; i < contentHeight; i++) paneLines.push(lines[i] || ' '.repeat(vw));
    } else {
      const scrollOffset = Math.max(0, selectedIndex - Math.floor(contentHeight / 2));
      for (let i = 0; i < contentHeight; i++) {
        const itemIdx = scrollOffset + i;
        if (itemIdx < flatList.length) {
          const { node, depth } = flatList[itemIdx];
          const isSelected = itemIdx === selectedIndex;
          const indent = '  '.repeat(depth);
          const hasChildren = node.children && node.children.length > 0;
          const foldIcon = hasChildren ? (node.folded ? '[+] ' : '[-] ') : '    ';
          const lineText = `${indent}${foldIcon}${node.text || '(empty)'}`;
          const truncated = lineText.slice(0, leftWidth - 2).padEnd(leftWidth - 1, ' ');

          if (isSelected) {
            paneLines.push(`\x1b[7;36m${truncated}\x1b[0m`);
          } else {
            paneLines.push(truncated);
          }
        } else {
          paneLines.push(' '.repeat(leftWidth - 1));
        }
      }
    }

    // 3. Prepare Right Pane (Inspector)
    const selectedItem = flatList[selectedIndex];
    const sNode = selectedItem ? selectedItem.node : null;
    const inspectorLines = [];

    if (sNode) {
      inspectorLines.push(`\x1b[1;33m📌 Node Details\x1b[0m`);
      inspectorLines.push(`\x1b[90mID:\x1b[0m ${sNode.id}`);
      inspectorLines.push(`\x1b[90mSide:\x1b[0m ${sNode.position || 'root/center'}`);
      inspectorLines.push(`\x1b[90mChildren:\x1b[0m ${sNode.children?.length || 0}`);
      inspectorLines.push(`\x1b[90mStyle:\x1b[0m ${sNode.style || 'default'}`);
      if (sNode.color) inspectorLines.push(`\x1b[90mColor:\x1b[0m ${sNode.color}`);
      inspectorLines.push('');
      inspectorLines.push(`\x1b[1;33m📝 Catatan / Note:\x1b[0m`);
      if (sNode.note) {
        const notePreview = sNode.note.split('\n').slice(0, 4);
        for (const nl of notePreview) {
          inspectorLines.push(`\x1b[37m${nl.slice(0, rightWidth - 2)}\x1b[0m`);
        }
      } else {
        inspectorLines.push(`\x1b[90m(Tidak ada catatan)\x1b[0m`);
      }
      inspectorLines.push('');
      inspectorLines.push(`\x1b[1;33m🔗 Arrowlinks / Relasi:\x1b[0m`);
      if (sNode.arrowlinks && sNode.arrowlinks.length > 0) {
        for (const al of sNode.arrowlinks) {
          inspectorLines.push(`──► ${al.target} ${al.label ? `(${al.label})` : ''}`);
        }
      } else {
        inspectorLines.push(`\x1b[90m(Tidak ada arrowlink)\x1b[0m`);
      }
    }

    while (inspectorLines.length < contentHeight) {
      inspectorLines.push('');
    }

    // Combine left and right panes
    for (let i = 0; i < contentHeight; i++) {
      const left = paneLines[i] || ' '.repeat(leftWidth - 1);
      const right = inspectorLines[i] ? inspectorLines[i].slice(0, rightWidth - 1) : '';
      buffer.push(`${left}\x1b[90m│\x1b[0m${right}\n`);
    }

    // 4. Status Bar (Row rows - 2)
    buffer.push(`\x1b[47;30m ${statusMessage.slice(0, cols - 2).padEnd(cols - 1, ' ')}\x1b[0m\n`);

    // 5. Interactive Command / Input Bar (Row rows - 1)
    if (mode === 'INPUT') {
      const promptLabel = '💬 Command > ';
      const promptLen = promptLabel.length;
      const maxInputWidth = cols - promptLen - 2;

      // Render text with visual block cursor
      const leftPart = inputBuffer.slice(0, cursorPosition);
      const cursorChar = inputBuffer[cursorPosition] || ' ';
      const rightPart = inputBuffer.slice(cursorPosition + 1);

      const displayLine = `${promptLabel}${leftPart}\x1b[7m${cursorChar}\x1b[0m${rightPart}`;
      buffer.push(`\x1b[1;33;40m${displayLine.slice(0, cols + 10).padEnd(cols + 8, ' ')}\x1b[0m`);
    } else {
      // Normal Mode Hint Bar
      const navHints = viewMode === 'canvas'
        ? ' [↑↓←→: Navigasi 2D] [Space: Lipat] [v: Outliner] [/]: Command [q]: Keluar'
        : ' [↑/↓: Nav] [/]: Command (/anak, /edit, /catatan, /peta, /cari) [Tab]: Anak [Enter]: Sibling [v]: Canvas [q]: Keluar';
      buffer.push(`\x1b[90;40m${navHints.slice(0, cols - 1).padEnd(cols, ' ')}\x1b[0m`);
    }

    stdout.write(buffer.join(''));
  }

  async function executeSlashCommand(rawCommand) {
    const cmd = rawCommand.trim();
    if (!cmd) return;

    // Normalizing command
    let action = '';
    let arg = '';

    if (cmd.startsWith('/')) {
      const firstSpace = cmd.indexOf(' ');
      if (firstSpace === -1) {
        action = cmd.slice(1).toLowerCase();
        arg = '';
      } else {
        action = cmd.slice(1, firstSpace).toLowerCase();
        arg = cmd.slice(firstSpace + 1).trim();
      }
    } else {
      // Default to /anak if plain text entered
      action = 'anak';
      arg = cmd;
    }

    const currentItem = flatList[selectedIndex];

    switch (action) {
      // 1. Tambah Anak (/anak <teks>, /child <teks>)
      case 'anak':
      case 'child': {
        if (!arg) {
          statusMessage = 'Gunakan: /anak <nama cabang>';
          break;
        }
        if (!currentItem) break;
        const newId = 'ID_' + Date.now().toString(36);
        await storage.addNode({
          id: newId,
          map_id: mapId,
          text: arg,
          note: null
        });
        await storage.addEdge({
          map_id: mapId,
          source: currentItem.node.id,
          target: newId,
          type: 'PARENT_OF',
          sort_order: currentItem.node.children ? currentItem.node.children.length : 0
        });
        await reloadMap();
        // Expand parent if folded
        if (currentItem.node.folded) {
          currentItem.node.folded = false;
          await storage.updateNode(currentItem.node.id, { folded: false });
          await reloadMap();
        }
        // Jump to newly created node
        const newIdx = flatList.findIndex(item => item.node.id === newId);
        if (newIdx !== -1) selectedIndex = newIdx;
        statusMessage = `✔ Cabang anak '${arg}' berhasil ditambahkan!`;
        break;
      }

      // 2. Tambah Sibling (/sejajar <teks>, /sibling <teks>)
      case 'sejajar':
      case 'sibling': {
        if (!arg) {
          statusMessage = 'Gunakan: /sejajar <nama cabang>';
          break;
        }
        if (!currentItem || !currentItem.parent) {
          statusMessage = 'Root node tidak bisa memiliki sibling!';
          break;
        }
        const newId = 'ID_' + Date.now().toString(36);
        await storage.addNode({
          id: newId,
          map_id: mapId,
          text: arg,
          note: null
        });
        await storage.addEdge({
          map_id: mapId,
          source: currentItem.parent.id,
          target: newId,
          type: 'PARENT_OF',
          sort_order: currentItem.parent.children ? currentItem.parent.children.length : 0
        });
        await reloadMap();
        const newIdx = flatList.findIndex(item => item.node.id === newId);
        if (newIdx !== -1) selectedIndex = newIdx;
        statusMessage = `✔ Cabang sejajar '${arg}' berhasil ditambahkan!`;
        break;
      }

      // 3. Edit Teks (/edit <teks>)
      case 'edit': {
        if (!arg) {
          statusMessage = 'Gunakan: /edit <teks baru>';
          break;
        }
        if (!currentItem) break;
        await storage.updateNode(currentItem.node.id, { text: arg });
        await reloadMap();
        statusMessage = `✔ Teks node diubah menjadi: '${arg}'`;
        break;
      }

      // 4. Tambah / Edit Catatan (/catatan <teks>, /note <teks>)
      case 'catatan':
      case 'note': {
        if (!currentItem) break;
        await storage.updateNode(currentItem.node.id, { note: arg || null });
        await reloadMap();
        statusMessage = arg ? `✔ Catatan berhasil diperbarui!` : `✔ Catatan dihapus.`;
        break;
      }

      // 5. Hapus Cabang (/hapus, /rm, /delete)
      case 'hapus':
      case 'rm':
      case 'delete': {
        if (!currentItem || !currentItem.parent) {
          statusMessage = 'Root node tidak bisa dihapus!';
          break;
        }
        const oldText = currentItem.node.text;
        await storage.deleteNode(currentItem.node.id);
        await reloadMap();
        selectedIndex = Math.max(0, selectedIndex - 1);
        statusMessage = `✔ Cabang '${oldText}' telah dihapus.`;
        break;
      }

      // 6. Buat Peta Baru (/peta <judul>, /map <judul>)
      case 'peta':
      case 'map':
      case 'new': {
        if (!arg) {
          statusMessage = 'Gunakan: /peta <nama peta baru>';
          break;
        }
        const newMapId = 'map_' + Date.now().toString(36);
        const newRootId = 'ID_' + Date.now().toString(36) + '_root';

        await storage.createMap({
          id: newMapId,
          title: arg,
          root_id: newRootId
        });
        await storage.addNode({
          id: newRootId,
          map_id: newMapId,
          text: arg,
          note: null
        });

        await reloadMap(newMapId);
        selectedIndex = 0;
        statusMessage = `✔ Peta baru '${arg}' berhasil dibuat dan dibuka!`;
        break;
      }

      // 7. Buka / Ganti Peta (/buka <id|nama>, /open)
      case 'buka':
      case 'open': {
        const maps = await storage.listMaps();
        if (!arg) {
          const names = maps.map((m, i) => `${i + 1}:${m.title}`).join(', ');
          statusMessage = `Peta tersedia: ${names}. Ketik: /buka <nomor>`;
          break;
        }
        const num = parseInt(arg, 10);
        let targetMap = null;
        if (!isNaN(num) && num > 0 && num <= maps.length) {
          targetMap = maps[num - 1];
        } else {
          targetMap = maps.find(m => m.id === arg || m.title.toLowerCase().includes(arg.toLowerCase()));
        }
        if (targetMap) {
          await reloadMap(targetMap.id);
          selectedIndex = 0;
          statusMessage = `✔ Membuka peta: '${targetMap.title}'`;
        } else {
          statusMessage = `❌ Peta '${arg}' tidak ditemukan.`;
        }
        break;
      }

      // 8. Cari Node & Lompat (/cari <kata>, /search <kata>)
      case 'cari':
      case 'search': {
        if (!arg) {
          statusMessage = 'Gunakan: /cari <kata kunci>';
          break;
        }
        const q = arg.toLowerCase();
        const foundIdx = flatList.findIndex(item =>
          (item.node.text && item.node.text.toLowerCase().includes(q)) ||
          (item.node.note && item.node.note.toLowerCase().includes(q))
        );
        if (foundIdx !== -1) {
          selectedIndex = foundIdx;
          statusMessage = `✔ Ditemukan: '${flatList[foundIdx].node.text}'`;
        } else {
          statusMessage = `❌ Tidak ditemukan node dengan kata '${arg}'.`;
        }
        break;
      }

      // 9. Lipat / Buka (/lipat, /fold)
      case 'lipat':
      case 'fold': {
        if (currentItem && currentItem.node.children && currentItem.node.children.length > 0) {
          currentItem.node.folded = !currentItem.node.folded;
          await storage.updateNode(currentItem.node.id, { folded: currentItem.node.folded });
          await reloadMap();
          statusMessage = currentItem.node.folded ? 'Cabang dilipat.' : 'Cabang dibuka.';
        }
        break;
      }

      // 10. Bantuan (/bantuan, /help)
      case 'bantuan':
      case 'help': {
        statusMessage = 'Command: /anak <txt>, /sejajar <txt>, /edit <txt>, /catatan <txt>, /hapus, /peta <nama>, /buka <no>, /cari <kata>, /keluar. Tombol v = Canvas 2D.';
        break;
      }

      // 11. Keluar (/keluar, /quit, /q)
      case 'keluar':
      case 'quit':
      case 'q': {
        cleanup();
        process.exit(0);
      }

      default: {
        statusMessage = `Command '/${action}' tidak dikenal. Ketik /bantuan untuk melihat daftar.`;
      }
    }
  }

  render();

  // Deteksi perubahan dari proses CLI / agent lain. SQLite berjalan dalam
  // mode WAL sehingga proses eksternal dapat menulis saat TUI tetap terbuka;
  // PRAGMA data_version naik setiap ada commit dari koneksi lain.
  let lastDataVersion = storage.getDataVersion ? storage.getDataVersion() : 0;
  let externalCheckBusy = false;
  if (typeof storage.getDataVersion === 'function') {
    watchTimer = setInterval(async () => {
      if (externalCheckBusy) return;
      externalCheckBusy = true;
      try {
        const version = storage.getDataVersion();
        if (version === lastDataVersion) return;
        lastDataVersion = version;
        await reloadMap();
        statusMessage = '🔄 Peta diperbarui oleh proses lain.';
        render();
      } catch (err) {
        lastDataVersion = storage.getDataVersion();
        statusMessage = `⚠️ Gagal memuat ulang: ${err.message}`;
        render();
      } finally {
        externalCheckBusy = false;
      }
    }, 900);
    if (watchTimer.unref) watchTimer.unref();
  }

  return new Promise((resolve) => {
    function startInputMode(initialText = '/') {
      mode = 'INPUT';
      inputBuffer = initialText;
      cursorPosition = initialText.length;
      render();
    }

    async function onKeypress(str, key) {
      // ==========================================
      // MODE INPUT / COMMAND BAR AKTIF
      // ==========================================
      if (mode === 'INPUT') {
        // Cancel input (Escape / Ctrl+C)
        if ((key && key.name === 'escape') || (key && key.ctrl && key.name === 'c')) {
          mode = 'NAV';
          inputBuffer = '';
          statusMessage = 'Input command dibatalkan.';
          render();
          return;
        }

        // Execute Command (Enter)
        if (key && (key.name === 'return' || key.name === 'enter')) {
          const commandToRun = inputBuffer;
          mode = 'NAV';
          inputBuffer = '';
          cursorPosition = 0;
          await executeSlashCommand(commandToRun);
          render();
          return;
        }

        // Backspace
        if (key && key.name === 'backspace') {
          if (cursorPosition > 0) {
            inputBuffer = inputBuffer.slice(0, cursorPosition - 1) + inputBuffer.slice(cursorPosition);
            cursorPosition--;
          } else if (inputBuffer.length === 0) {
            mode = 'NAV';
          }
          render();
          return;
        }

        // Left arrow
        if (key && key.name === 'left') {
          if (cursorPosition > 0) cursorPosition--;
          render();
          return;
        }

        // Right arrow
        if (key && key.name === 'right') {
          if (cursorPosition < inputBuffer.length) cursorPosition++;
          render();
          return;
        }

        // Home / Ctrl+A
        if ((key && key.name === 'home') || (key && key.ctrl && key.name === 'a')) {
          cursorPosition = 0;
          render();
          return;
        }

        // End / Ctrl+E
        if ((key && key.name === 'end') || (key && key.ctrl && key.name === 'e')) {
          cursorPosition = inputBuffer.length;
          render();
          return;
        }

        // Normal typing
        if (str && !key.ctrl && !key.meta && str.length === 1) {
          inputBuffer = inputBuffer.slice(0, cursorPosition) + str + inputBuffer.slice(cursorPosition);
          cursorPosition++;
          render();
          return;
        }

        return;
      }

      // ==========================================
      // MODE NAV (NAVIGASI POHON BIASA)
      // ==========================================

      // Quit
      if (str === 'q' || (key && key.ctrl && key.name === 'c')) {
        cleanup();
        stdin.removeListener('keypress', onKeypress);
        resolve();
        return;
      }

      // Toggle tampilan: Outliner <-> Canvas 2D
      if (str === 'v') {
        viewMode = viewMode === 'canvas' ? 'outliner' : 'canvas';
        panX = 0; panY = 0;
        statusMessage = viewMode === 'canvas'
          ? 'Mode Canvas 2D: panah = navigasi, Space = lipat, v = kembali ke Outliner.'
          : 'Mode Outliner: v = tampilan Canvas 2D.';
        render();
        return;
      }

      // Navigasi spasial 2D saat mode canvas
      if (viewMode === 'canvas' && key && ['up', 'down', 'left', 'right'].includes(key.name)) {
        const grid = renderCanvas(root, { color: true, ascii: asciiCanvas });
        const current = flatList[selectedIndex]?.node || null;
        const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[key.name];
        const next = findCanvasNeighbor(grid, current, dir[0], dir[1]);
        if (next) {
          const idx = flatList.findIndex((it) => it.node === next);
          if (idx >= 0) { selectedIndex = idx; render(); }
        }
        return;
      }

      // Navigate down
      if (str === 'j' || (key && key.name === 'down')) {
        if (selectedIndex < flatList.length - 1) {
          selectedIndex++;
          render();
        }
      }
      // Navigate up
      else if (str === 'k' || (key && key.name === 'up')) {
        if (selectedIndex > 0) {
          selectedIndex--;
          render();
        }
      }
      // Fold / Unfold (Space)
      else if (str === ' ' || (key && key.name === 'space')) {
        const item = flatList[selectedIndex];
        if (item && item.node.children && item.node.children.length > 0) {
          item.node.folded = !item.node.folded;
          await storage.updateNode(item.node.id, { folded: item.node.folded });
          await reloadMap();
          render();
        }
      }
      // Open Command Input Bar (/)
      else if (str === '/' || str === ':') {
        startInputMode('/');
      }
      // Shortcut Tab -> pre-fill /anak
      else if (key && key.name === 'tab') {
        startInputMode('/anak ');
      }
      // Shortcut Enter -> pre-fill /sejajar
      else if (key && (key.name === 'return' || key.name === 'enter')) {
        startInputMode('/sejajar ');
      }
      // Shortcut e -> pre-fill /edit
      else if (str === 'e') {
        const item = flatList[selectedIndex];
        const currentText = item ? (item.node.text || '') : '';
        startInputMode(`/edit ${currentText}`);
      }
      // Shortcut d -> pre-fill /hapus
      else if (str === 'd') {
        startInputMode('/hapus');
      }
      // Shortcut n -> pre-fill /peta
      else if (str === 'n') {
        startInputMode('/peta ');
      }
      // Shortcut m -> pre-fill /buka
      else if (str === 'm') {
        startInputMode('/buka ');
      }
    }

    stdin.on('data', (data) => {
      // Decode keypress manually or through keypress parser
      const str = data.toString();
      let key = { name: '' };

      if (str === '\r' || str === '\n') key.name = 'return';
      else if (str === '\t') key.name = 'tab';
      else if (str === '\x7f' || str === '\x08') key.name = 'backspace';
      else if (str === '\x1b') key.name = 'escape';
      else if (str === '\x1b[A') key.name = 'up';
      else if (str === '\x1b[B') key.name = 'down';
      else if (str === '\x1b[C') key.name = 'right';
      else if (str === '\x1b[D') key.name = 'left';
      else if (str === ' ') key.name = 'space';
      else if (str === '\x03') { key.name = 'c'; key.ctrl = true; }

      onKeypress(str, key);
    });
  });
}
