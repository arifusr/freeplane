// Renderer 2D mindmap untuk terminal (gaya DOS/ASCII).
//
// Layout: root di kiri, cabang tumbuh ke KANAN. Anak selalu didistribusikan
// vertikal mengelilingi induknya:
//   2 anak  -> satu di atas, satu di bawah
//   3 anak  -> atas, tengah (sejajar induk), bawah
//   dst.    -> tetap seimbang; aturan yang sama berlaku rekursif di tiap level.
//
// Node digambar satu baris: [ Teks ] (plus penanda lipat ▾/▸ di kanan).
// Edge memakai karakter box-drawing; mode --ascii memakai + - |.

const MAX_LABEL_DEFAULT = 40;
const LEVEL_GAP = 6;   // jarak kolom antar-level
const ROW_GAP = 2;     // jarak baris antar-daun (menyisakan 1 baris kosong)

// Bit arah untuk peta koneksi edge.
const U = 1, D = 2, L = 4, R = 8;
const GLYPH = {
  0: ' ', 1: '│', 2: '│', 3: '│', 4: '─', 5: '┘', 6: '┐', 7: '┤',
  8: '─', 9: '└', 10: '┌', 11: '├', 12: '─', 13: '┴', 14: '┬', 15: '┼'
};

function asciiGlyph(mask) {
  if ((mask & (U | D)) && (mask & (L | R))) return '+';
  if (mask & (U | D)) return '|';
  if (mask & (L | R)) return '-';
  return ' ';
}

// Perkiraan lebar tampilan: CJK/emoji = 2 kolom, sisanya 1.
function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x1100 && (
    c <= 0x115f || c === 0x2329 || c === 0x232a ||
    (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe19) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1f64f) ||
    (c >= 0x1f900 && c <= 0x1f9ff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )) return 2;
  return 1;
}

export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch);
  return w;
}

function labelOf(node, maxLabel) {
  let t = String(node.text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) t = '(kosong)';
  if (maxLabel > 0 && t.length > maxLabel) {
    t = t.slice(0, Math.max(1, maxLabel - 1)) + '…';
  }
  return t;
}

function visibleChildren(node) {
  return node.folded ? [] : (node.children || []);
}

/**
 * Hitung posisi 2D semua node (koordinat sel karakter).
 * Mengembalikan { nodes, width, height, maxDepth, ... } dan menempelkan
 * properti _canvasX/_canvasY/_canvasW ke setiap node.
 */
export function layoutCanvas(root, options = {}) {
  const ascii = !!options.ascii;
  const maxLabel = options.maxLabel ?? MAX_LABEL_DEFAULT;
  const levelGap = options.levelGap ?? LEVEL_GAP;
  const rowGap = options.rowGap ?? ROW_GAP;

  const nodes = [];
  let maxDepth = 0;
  (function collect(n, depth, parent = null) {
    n._canvasDepth = depth;
    n._canvasParent = parent;
    maxDepth = Math.max(maxDepth, depth);
    nodes.push(n);
    for (const c of visibleChildren(n)) collect(c, depth + 1, n);
  })(root, 0, null);

  for (const n of nodes) {
    const label = labelOf(n, maxLabel);
    const hasChildren = (n.children || []).length > 0;
    n._canvasLabel = label;
    n._canvasHasChildren = hasChildren;
    n._canvasMarker = hasChildren ? (n.folded ? (ascii ? '+' : '▸') : (ascii ? '-' : '▾')) : '';
    n._canvasW = displayWidth(label) + 4 + (hasChildren ? 2 : 0);
  }

  // Kolom x per level: selebar node terlebar pada level tersebut.
  const maxWidth = [];
  for (const n of nodes) maxWidth[n._canvasDepth] = Math.max(maxWidth[n._canvasDepth] || 0, n._canvasW);
  const xAt = [0];
  for (let d = 1; d <= maxDepth; d++) {
    xAt[d] = xAt[d - 1] + (maxWidth[d - 1] || 0) + levelGap;
  }

  // Baris y: daun mendapat slot berurutan, induk dipusatkan di antara
  // anak pertama & terakhir -> 2 anak = atas/bawah, 3 anak = atas/tengah/bawah.
  let nextRow = 0;
  (function assignY(n) {
    const kids = visibleChildren(n);
    if (kids.length === 0) {
      n._canvasY = nextRow;
      nextRow += rowGap;
      return;
    }
    for (const c of kids) assignY(c);
    // Genap: pusatkan di antara dua anak tengah. Ganjil: sejajarkan dengan
    // anak tengah (3 anak -> atas, tengah, bawah).
    const k = kids.length;
    n._canvasY = k % 2 === 1
      ? kids[(k - 1) / 2]._canvasY
      : Math.round((kids[k / 2 - 1]._canvasY + kids[k / 2]._canvasY) / 2);
  })(root);

  let minY = Infinity;
  for (const n of nodes) minY = Math.min(minY, n._canvasY);
  for (const n of nodes) {
    n._canvasX = xAt[n._canvasDepth];
    n._canvasY -= minY;
  }

  const width = xAt[maxDepth] + (maxWidth[maxDepth] || 0);
  let height = 1;
  for (const n of nodes) height = Math.max(height, n._canvasY + 1);
  return { nodes, width, height, maxDepth, maxLabel, levelGap, rowGap, ascii };
}

function putText(chars, styles, owners, x, y, text, style, owner) {
  let cx = x;
  const row = chars[y];
  if (!row) return;
  for (const ch of text) {
    if (cx >= row.length) break;
    const w = charWidth(ch);
    row[cx] = ch;
    styles[y][cx] = style;
    owners[y][cx] = owner;
    if (w === 2 && cx + 1 < row.length) {
      row[cx + 1] = '';
      styles[y][cx + 1] = style;
      owners[y][cx + 1] = owner;
    }
    cx += w;
  }
}

/**
 * Render mindmap ke grid karakter + style ANSI.
 * Returns { nodes, width, height, chars, styles, owners, ascii }.
 */
export function renderCanvas(root, options = {}) {
  const color = options.color !== false;
  const canvas = layoutCanvas(root, options);
  const { nodes, width, height, ascii } = canvas;

  const chars = Array.from({ length: height }, () => new Array(width).fill(' '));
  const styles = Array.from({ length: height }, () => new Array(width).fill(''));
  const owners = Array.from({ length: height }, () => new Array(width).fill(null));
  const mask = Array.from({ length: height }, () => new Uint8Array(width));

  const addH = (x1, x2, y) => {
    for (let x = Math.max(0, x1); x <= Math.min(width - 1, x2); x++) {
      if (x > x1) mask[y][x] |= L;
      if (x < x2) mask[y][x] |= R;
    }
  };
  const addV = (x, y1, y2) => {
    for (let y = Math.max(0, y1); y <= Math.min(height - 1, y2); y++) {
      if (y > y1) mask[y][x] |= U;
      if (y < y2) mask[y][x] |= D;
    }
  };

  // Edge: batang horizontal dari induk ke bus vertikal, lalu bercabang ke anak.
  for (const n of nodes) {
    const kids = visibleChildren(n);
    if (kids.length === 0) continue;
    const right = n._canvasX + n._canvasW - 1;
    const bus = right + 2;
    const py = n._canvasY;
    addH(right + 1, bus, py);
    for (const c of kids) {
      addV(bus, Math.min(py, c._canvasY), Math.max(py, c._canvasY));
      addH(bus, c._canvasX - 1, c._canvasY);
    }
  }

  const edgeStyle = color ? '\x1b[90m' : '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = mask[y][x];
      if (!m) continue;
      chars[y][x] = ascii ? asciiGlyph(m) : GLYPH[m];
      styles[y][x] = edgeStyle;
    }
  }

  const rootStyle = color ? '\x1b[1;33m' : '';
  const foldedStyle = color ? '\x1b[90m' : '';
  for (const n of nodes) {
    const label = `[ ${n._canvasLabel} ]${n._canvasHasChildren ? ' ' + n._canvasMarker : ''}`;
    const style = n === root ? rootStyle : (n.folded ? foldedStyle : '');
    putText(chars, styles, owners, n._canvasX, n._canvasY, label, style, n);
  }

  return { ...canvas, chars, styles, owners };
}

/**
 * Ubah grid menjadi baris teks (opsional: potong viewport & sorot node terpilih).
 */
export function canvasLines(canvas, opts = {}) {
  const color = opts.color !== false;
  const x0 = Math.max(0, opts.x0 || 0);
  const y0 = Math.max(0, opts.y0 || 0);
  const vw = Math.max(0, opts.width ?? canvas.width);
  const vh = Math.max(0, opts.height ?? canvas.height);
  const selected = opts.selected || null;
  const lines = [];

  for (let y = y0; y < Math.min(canvas.height, y0 + vh); y++) {
    let out = '', cur = '', buf = '', used = 0;
    const flush = () => {
      if (!buf) return;
      if (color && cur) out += cur + buf + '\x1b[0m';
      else out += buf;
      buf = '';
    };
    for (let x = x0; x < Math.min(canvas.width, x0 + vw); x++) {
      let st = color ? (canvas.styles[y][x] || '') : '';
      if (selected && y === selected._canvasY &&
          x >= selected._canvasX && x < selected._canvasX + selected._canvasW) {
        st = color ? '\x1b[7;33m' : '';
      }
      if (st !== cur) { flush(); cur = st; }
      const ch = canvas.chars[y][x] ?? ' ';
      buf += ch;
      used += ch ? charWidth(ch) : 0;
    }
    flush();
    if (used < vw) out += ' '.repeat(vw - used);
    lines.push(out);
  }
  return lines;
}

/**
 * Navigasi spasial pada canvas: node terdekat pada arah (dx, dy).
 */
export function findCanvasNeighbor(canvas, from, dx, dy) {
  if (!from || !canvas || !canvas.nodes || canvas.nodes.length === 0) return null;

  // 1. Navigasi Horizontal: LEFT (ke induk / kolom kiri)
  if (dx < 0) {
    if (from._canvasParent) return from._canvasParent;
    let best = null, bestScore = Infinity;
    for (const n of canvas.nodes) {
      if (n === from || n._canvasX >= from._canvasX) continue;
      const dX = from._canvasX - n._canvasX;
      const dY = Math.abs(n._canvasY - from._canvasY);
      const score = dX * 2 + dY;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  // 2. Navigasi Horizontal: RIGHT (ke anak / kolom kanan)
  if (dx > 0) {
    const kids = from.folded ? [] : (from.children || []);
    if (kids.length > 0) {
      let bestChild = null, bestChildDist = Infinity;
      for (const c of kids) {
        const dY = Math.abs(c._canvasY - from._canvasY);
        if (dY < bestChildDist) { bestChildDist = dY; bestChild = c; }
      }
      return bestChild;
    }
    let best = null, bestScore = Infinity;
    for (const n of canvas.nodes) {
      if (n === from || n._canvasX <= from._canvasX) continue;
      const dX = n._canvasX - from._canvasX;
      const dY = Math.abs(n._canvasY - from._canvasY);
      const score = dX * 2 + dY;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  // 3. Navigasi Vertikal: UP (dy = -1) atau DOWN (dy = 1)
  if (dy !== 0) {
    const isDown = dy > 0;
    // Prioritas utama: simpul terdekat pada kolom/level (_canvasX) yang sama
    let sameColBest = null, sameColMinDY = Infinity;
    for (const n of canvas.nodes) {
      if (n === from) continue;
      if (n._canvasX !== from._canvasX) continue;
      const diffY = isDown ? (n._canvasY - from._canvasY) : (from._canvasY - n._canvasY);
      if (diffY > 0 && diffY < sameColMinDY) {
        sameColMinDY = diffY;
        sameColBest = n;
      }
    }
    if (sameColBest) return sameColBest;

    // Fallback lintas kolom jika kolom saat ini tidak memiliki simpul ke arah tersebut (misal di root)
    let crossBest = null, crossBestScore = Infinity;
    for (const n of canvas.nodes) {
      if (n === from) continue;
      const diffY = isDown ? (n._canvasY - from._canvasY) : (from._canvasY - n._canvasY);
      if (diffY <= 0) continue;
      const colDiff = Math.abs((n._canvasDepth ?? 0) - (from._canvasDepth ?? 0));
      const score = diffY + colDiff * 20;
      if (score < crossBestScore) {
        crossBestScore = score;
        crossBest = n;
      }
    }
    return crossBest;
  }

  return null;
}
