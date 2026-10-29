// freemind-web-canvas — inti reimplementasi FreeMind (model, .mm, layout, render)
// Referensi algoritma: freemind/freemind/{modes,view/mindmapview} (commit a3674b0).
// Lihat catatan renv: "Spesifikasi model node & format .mm (presisi)", dst.

export const SPACE_AROUND = 50; // NodeView.SPACE_AROUND
export const VGAP = 3;          // NodeAdapter.VGAP
export const HGAP = 20;         // NodeAdapter.HGAP
export const SHIFT = -2;        // NodeAdapter.SHIFT (single visible child)
export const HANDLE_W = 10;     // NodeViewLayoutAdapter.LISTENER_VIEW_WIDTH
export const ICON_SIZE = 16;    // ukuran ikon BUILTIN (MultipleImage)
export const FOLD_SYMBOL = 8;   // NodeView.getFoldingSymbolWidth() default
export const EDGE_XCTRL = 12;   // BezierEdgeView.XCTRL
export const EDGE_CHILD_XCTRL = 20; // BezierEdgeView.CHILD_XCTRL
export const ATTR_ROW_H = 15;   // tinggi satu baris atribut (AttributeView)
export const ATTR_FONT = '11px sans-serif';
export const ATTR_PAD = 4;

// ---------------------------------------------------------------------------
// Parser XML minimal (cukup untuk .mm): elemen, atribut, entitas, CDATA, komentar.
// Menyimpan substring mentah isi elemen (`raw`) agar <richcontent> HTML utuh.
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X'
        ? parseInt(e.slice(2), 16)
        : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
  });
}

export function parseXML(src) {
  let i = 0;
  const root = { name: '#root', attrs: {}, children: [], text: '', raw: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { top().text += src.slice(i); break; }
    if (lt > i) top().text += src.slice(i, lt);

    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      top().text += src.slice(lt + 9, end);
      i = end + 3; continue;
    }
    if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt) + 2; continue; }
    if (src.startsWith('<!', lt)) { i = src.indexOf('>', lt) + 1; continue; }

    const gt = src.indexOf('>', lt);
    if (gt === -1) break;
    let tag = src.slice(lt + 1, gt);
    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1);
    tag = tag.trim();

    if (tag.startsWith('/')) {
      const el = stack.pop();
      if (el) el.raw = src.slice(el._start, lt);
      i = gt + 1; continue;
    }

    const sp = tag.search(/\s/);
    const name = sp === -1 ? tag : tag.slice(0, sp);
    const attrStr = sp === -1 ? '' : tag.slice(sp + 1);
    const el = { name, attrs: parseAttrs(attrStr), children: [], text: '', raw: '' };
    top().children.push(el);
    if (selfClosing) el.raw = '';
    else { el._start = gt + 1; stack.push(el); }
    i = gt + 1;
  }
  return root;
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  return attrs;
}

const firstChild = (el, name) => el.children.find((c) => c.name === name);

// Point .mm: "x;y;" (Tools.PointToXml). Kosong → null.
function parsePoint(s) {
  if (!s) return null;
  const p = s.split(';').map(Number);
  return (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? { x: p[0], y: p[1] } : null;
}
const pointToXml = (p) => `${p.x};${p.y};`;

// ---------------------------------------------------------------------------
// Model node
// ---------------------------------------------------------------------------
export function createNode(text = '') {
  return {
    text, folded: false, position: null, style: null,
    color: null, bg: null, textAlign: null, edge: null, font: null,
    icons: [], rich: null, note: null, cloud: null, arrowlinks: [], attrs: [], children: [],
    summary: false, firstGroup: false,
    hGap: HGAP, vGap: VGAP, shiftY: 0,
  };
}

export function freshId(used) {
  let id, i = 0;
  do { id = 'ID_' + Date.now().toString(36) + '_' + (i++); } while (used.has(id));
  used.add(id);
  return id;
}

// ID yang sudah ada harus dipertahankan agar arrowlink lama tetap valid.
export function ensureNodeId(node, used) {
  if (node.id) { used.add(node.id); return node.id; }
  node.id = freshId(used);
  return node.id;
}

const toBool = (v) => v === 'true';

export function parseMM(xml) {
  const doc = parseXML(xml);
  const mapEl = doc.name === 'map' ? doc : firstChild(doc, 'map') || doc;
  const nodeEl = firstChild(mapEl, 'node');
  return nodeEl ? buildNode(nodeEl) : null;
}

function buildNode(el) {
  const a = el.attrs;
  const node = createNode(a.TEXT || '');
  node.folded = toBool(a.FOLDED);
  node.position = a.POSITION || null;
  node.color = a.COLOR || null;
  node.bg = a.BACKGROUND_COLOR || null;
  node.style = a.STYLE || null;
  node.textAlign = a.TEXT_ALIGN || null;
  node.id = a.ID || null;
  node.link = a.LINK || null;
  node.hGap = parseInt(a.HGAP, 10) || HGAP;
  node.vGap = parseInt(a.VGAP, 10) || VGAP;
  node.shiftY = parseInt(a.VSHIFT, 10) || 0;
  for (const c of el.children) {
    switch (c.name) {
      case 'edge':
        node.edge = {
          style: c.attrs.STYLE || 'bezier',
          color: c.attrs.COLOR || null,
          width: c.attrs.WIDTH === 'thin' || c.attrs.WIDTH === '1'
            ? 1 : (parseInt(c.attrs.WIDTH, 10) || 1),
        };
        break;
      case 'font':
        node.font = {
          name: c.attrs.NAME || null, size: parseInt(c.attrs.SIZE, 10) || 0,
          bold: toBool(c.attrs.BOLD), italic: toBool(c.attrs.ITALIC),
          underline: toBool(c.attrs.UNDERLINE),
        };
        break;
      case 'icon': node.icons.push(c.attrs.BUILTIN || ''); break;
      case 'cloud': node.cloud = { color: c.attrs.COLOR || null }; break;
      case 'arrowlink':
        node.arrowlinks.push({
          destination: c.attrs.DESTINATION || null,
          color: c.attrs.COLOR || null,
          startArrow: c.attrs.STARTARROW || 'None',
          endArrow: c.attrs.ENDARROW || 'Default',
          startInclination: parsePoint(c.attrs.STARTINCLINATION),
          endInclination: parsePoint(c.attrs.ENDINCLINATION),
          sourceLabel: c.attrs.SOURCE_LABEL || null,
          middleLabel: c.attrs.MIDDLE_LABEL || null,
          targetLabel: c.attrs.TARGET_LABEL || null,
        });
        break;
      case 'richcontent':
        if (c.attrs.TYPE === 'NOTE') node.note = c.raw; else node.rich = c.raw;
        break;
      case 'attribute': node.attrs.push({ name: c.attrs.NAME || '', value: c.attrs.VALUE || '' }); break;
      case 'hook':
        if (c.attrs.NAME === 'SummaryNode') node.summary = true;
        else if (c.attrs.NAME === 'FirstGroupNode') node.firstGroup = true;
        break;
      case 'node': node.children.push(buildNode(c)); break;
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// Emitter .mm (tulis atribut non-default, urutan ala NodeAdapter.save)
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r\n?|\n/g, '&#10;');

export function serializeMM(root, { version = '1.1.0' } = {}) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<map version="${version}">\n` + serializeNode(root, 1) + '\n</map>\n';
}

function serializeNode(node, depth) {
  const ind = '\t'.repeat(depth);
  const A = [`TEXT="${esc(node.text)}"`];
  if (node.position) A.push(`POSITION="${node.position}"`);
  if (node.folded) A.push('FOLDED="true"');
  if (node.style) A.push(`STYLE="${esc(node.style)}"`);
  if (node.color) A.push(`COLOR="${esc(node.color)}"`);
  if (node.bg) A.push(`BACKGROUND_COLOR="${esc(node.bg)}"`);
  if (node.textAlign) A.push(`TEXT_ALIGN="${esc(node.textAlign)}"`);
  if (node.id) A.push(`ID="${esc(node.id)}"`);
  if (node.link) A.push(`LINK="${esc(node.link)}"`);
  if (node.hGap !== HGAP) A.push(`HGAP="${node.hGap}"`);
  if (node.vGap !== VGAP) A.push(`VGAP="${node.vGap}"`);
  if (node.shiftY) A.push(`VSHIFT="${node.shiftY}"`);

  const kids = [];
  if (node.edge && (node.edge.style !== 'bezier' || node.edge.color || node.edge.width !== 1)) {
    const e = [];
    if (node.edge.style && node.edge.style !== 'bezier') e.push(`STYLE="${esc(node.edge.style)}"`);
    if (node.edge.color) e.push(`COLOR="${esc(node.edge.color)}"`);
    if (node.edge.width && node.edge.width !== 1) e.push(`WIDTH="${node.edge.width}"`);
    if (e.length) kids.push(`${ind}\t<edge ${e.join(' ')}/>`);
  }
  if (node.cloud) {
    kids.push(node.cloud.color ? `${ind}\t<cloud COLOR="${esc(node.cloud.color)}"/>` : `${ind}\t<cloud/>`);
  }
  for (const al of node.arrowlinks) {
    const e = [];
    if (al.destination) e.push(`DESTINATION="${esc(al.destination)}"`);
    if (al.color) e.push(`COLOR="${esc(al.color)}"`);
    if (al.sourceLabel) e.push(`SOURCE_LABEL="${esc(al.sourceLabel)}"`);
    if (al.targetLabel) e.push(`TARGET_LABEL="${esc(al.targetLabel)}"`);
    if (al.middleLabel) e.push(`MIDDLE_LABEL="${esc(al.middleLabel)}"`);
    e.push(`STARTARROW="${esc(al.startArrow)}"`, `ENDARROW="${esc(al.endArrow)}"`);
    if (al.startInclination) e.push(`STARTINCLINATION="${pointToXml(al.startInclination)}"`);
    if (al.endInclination) e.push(`ENDINCLINATION="${pointToXml(al.endInclination)}"`);
    kids.push(`${ind}\t<arrowlink ${e.join(' ')}/>`);
  }
  for (const ic of node.icons) kids.push(`${ind}\t<icon BUILTIN="${esc(ic)}"/>`);
  if (node.font) {
    const f = [];
    if (node.font.name) f.push(`NAME="${esc(node.font.name)}"`);
    if (node.font.size) f.push(`SIZE="${node.font.size}"`);
    if (node.font.bold) f.push('BOLD="true"');
    if (node.font.italic) f.push('ITALIC="true"');
    if (node.font.underline) f.push('UNDERLINE="true"');
    if (f.length) kids.push(`${ind}\t<font ${f.join(' ')}/>`);
  }
  for (const at of node.attrs) kids.push(`${ind}\t<attribute NAME="${esc(at.name)}" VALUE="${esc(at.value)}"/>`);
  if (node.rich !== null && node.rich !== undefined) kids.push(`${ind}\t<richcontent TYPE="NODE">${node.rich}</richcontent>`);
  if (node.note !== null && node.note !== undefined) kids.push(`${ind}\t<richcontent TYPE="NOTE">${node.note}</richcontent>`);
  if (node.firstGroup) kids.push(`${ind}\t<hook NAME="FirstGroupNode"/>`);
  if (node.summary) kids.push(`${ind}\t<hook NAME="SummaryNode"/>`);
  for (const c of node.children) kids.push(serializeNode(c, depth + 1));

  if (kids.length === 0) return `${ind}<node ${A.join(' ')}/>`;
  return `${ind}<node ${A.join(' ')}>\n${kids.join('\n')}\n${ind}</node>`;
}

export function clone(root) { return root ? parseMM(serializeMM(root)) : null; }

// ---------------------------------------------------------------------------
// Sisi (kiri/kanan)
// ---------------------------------------------------------------------------
function splitChildren(node, isRoot) {
  const right = [], left = [];
  for (const c of node.children) {
    const s = isRoot ? (c.position === 'left' ? 'left' : 'right') : (node._side || 'right');
    c._side = s;
    (s === 'left' ? left : right).push(c);
  }
  return { right, left };
}

// ---------------------------------------------------------------------------
// Layout: satu lintasan bottom-up, bbox lokal, lalu penempatan global.
// measure(node) -> {w,h} ukuran konten node.
// ---------------------------------------------------------------------------
let measureFn = (node) => {
  const lines = textLines(node);
  const w = Math.max(...lines.map((l) => l.length), 0) * 7 + 12;
  return { w: Math.max(20, w), h: Math.max(20, lines.length * lineHeight(node) + 6) };
};
export function setMeasure(fn) { measureFn = fn; }

// Teks node dapat multi-baris; setiap '\n' menjadi baris baru (NodeAdapter).
// Tab dirender sebagai 4 spasi agar indentasi terlihat sama di Canvas/SVG.
export function textLines(node) { return String(node.text ?? '').replace(/\t/g, '    ').split(/\r?\n/); }
export function lineHeight(node) {
  const f = node.font || {};
  return Math.max(14, (f.size || 14) * 1.2);
}

export function layout(root) {
  walk(root, () => {}, null);   // set _parent sebelum layout (dipakai style & calcShiftY)
  assignSides(root, true);
  measureBBox(root, true);
  root._contentX = 0;
  root._contentY = 0;
  place(root);
  return root;
}

function assignSides(node, isRoot) {
  const { right, left } = splitChildren(node, isRoot);
  node._right = right; node._left = left;
  for (const c of node.children) assignSides(c, false);
}

function subtreeHeight(list, vGap) {
  if (list.length === 0) return 0;
  return list.reduce((s, c) => s + c._bh, 0) + vGap * (list.length - 1);
}

function measureBBox(node) {
  const m = measureFn(node);
  node._w = m.w; node._h = m.h;
  for (const c of node.children) measureBBox(c);
  // Node terlipat menyembunyikan seluruh subtree-nya: anak tidak menyumbang
  // ukuran (jadi sibling menggantikan ruangnya), sesuai perilaku FreeMind.
  const open = !node.folded;
  const normalR = node._right.filter((c) => !c.summary);
  const normalL = node._left.filter((c) => !c.summary);
  const rh = open ? subtreeHeight(normalR, node.vGap) : 0;
  const lh = open ? subtreeHeight(normalL, node.vGap) : 0;
  // HGap milik anak (jarak anak dari induk), sesuai NodeViewLayoutAdapter.getChildHorizontalShift.
  let rExt = open && normalR.length ? Math.max(...normalR.map((c) => c.hGap + c._bw)) : 0;
  let lExt = open && normalL.length ? Math.max(...normalL.map((c) => c.hGap + c._bw)) : 0;
  // Summary node berada di luar grup (bukan baris sibling biasa), jadi lebar
  // subtree-nya dihitung dari tepi luar grup + SUMMARY_HGAP.
  if (open) {
    const rContent = normalR.length ? Math.max(...normalR.map((c) => c.hGap + c._cx + c._w)) : 0;
    const lContent = normalL.length ? Math.max(...normalL.map((c) => c.hGap + c._bw - c._cx)) : 0;
    for (const c of node.children) {
      if (!c.summary) continue;
      if (c._side === 'left') lExt = Math.max(lExt, lContent + c.hGap + c._w + c._cx);
      else rExt = Math.max(rExt, rContent + c.hGap + c._bw - c._cx);
    }
  }
  const maxSummaryH = node.children.reduce((m, c) => (c.summary ? Math.max(m, c._bh) : m), 0);
  node._bw = lExt + node._w + rExt;
  node._bh = Math.max(node._h, rh, lh, maxSummaryH);
  node._cx = lExt;
  node._cy = (node._bh - node._h) / 2;
}

// NodeAdapter.calcShiftY(): shiftY + SHIFT bila induk punya tepat satu anak terlihat.
function calcShiftY(c) {
  const p = c._parent;
  return c.shiftY + (p && p.children.length === 1 ? SHIFT : 0);
}

function place(node) {
  if (node.folded) return; // subtree tersembunyi tidak ditempatkan
  for (const side of ['right', 'left']) {
    const list = node[`_${side}`].filter((c) => !c.summary);
    const total = subtreeHeight(list, node.vGap);
    let y = node._contentY + node._h / 2 - total / 2;
    for (const c of list) {
      y += calcShiftY(c);
      const bx = side === 'right'
        ? node._contentX + node._w + c.hGap
        : node._contentX - c.hGap - c._bw;
      c._contentX = bx + c._cx;
      c._contentY = y + c._cy;
      place(c);
      y += c._bh + node.vGap;
    }
  }
  // Summary node: letakkan di luar grup (sisi terjauh) dan pusatkan pada
  // rentang vertikal node yang diringkas (VerticalNodeViewLayoutStrategy).
  for (const side of ['right', 'left']) {
    for (const c of node[`_${side}`]) {
      if (!c.summary) continue;
      const group = summaryGroup(c);
      if (!group.length) {
        c._contentX = side === 'left'
          ? node._contentX - c.hGap - c._w
          : node._contentX + node._w + c.hGap;
        c._contentY = node._contentY + node._h / 2 - baseH(c) / 2 + c.shiftY;
      } else {
        const left = side === 'left';
        let top = Infinity, bottom = -Infinity, outer = left ? Infinity : -Infinity;
        for (const g of group) {
          top = Math.min(top, g._contentY);
          bottom = Math.max(bottom, g._contentY + baseH(g));
          outer = left
            ? Math.min(outer, g._contentX)
            : Math.max(outer, g._contentX + g._w);
        }
        c._contentX = left ? outer - c.hGap - c._w : outer + c.hGap;
        c._contentY = (top + bottom) / 2 - baseH(c) / 2 + c.shiftY;
      }
      place(c);
    }
  }
}

// Tinggi kotak node inti (tanpa blok atribut yang menggantung di bawahnya).
function baseH(node) { return node._baseH != null ? node._baseH : node._h; }

// Titik masuk/keluar node (analog MainView getLeft/Center/RightPoint).
export function inPoint(node) {
  if (node._side === 'left') return { x: node._contentX + node._w, y: node._contentY + baseH(node) / 2 };
  return { x: node._contentX, y: node._contentY + baseH(node) / 2 };
}
export function outPoint(node) {
  if (node._side === 'left') return { x: node._contentX, y: node._contentY + baseH(node) / 2 };
  return { x: node._contentX + node._w, y: node._contentY + baseH(node) / 2 };
}

// ---------------------------------------------------------------------------
// Summary node (SummaryNode / FirstGroupNode Freeplane): node ringkasan adalah
// sibling dari node yang diringkas; kurung (bracket) membentang dari node
// pertama grup sampai node terakhir, lalu mengerucut ke node ringkasan.
// Batas grup ditandai `firstGroup` pada sibling pertama (padanan hook
// FirstGroupNode) dan/atau oleh ringkasan sebelumnya.
// ---------------------------------------------------------------------------
export const SUMMARY_GAP = 10;   // jarak bracket dari tepi luar grup
export const SUMMARY_HGAP = 30;  // jarak default summary node dari tepi luar grup
const SUMMARY_XCTRL = 4;         // SummaryEdgeView.XCTRL

export function summaryGroup(summary) {
  const p = summary && summary._parent;
  if (!p || !summary.summary) return [];
  const side = summary._side;
  const i = p.children.indexOf(summary);
  const out = [];
  for (let j = i - 1; j >= 0; j--) {
    const c = p.children[j];
    if (c._side !== side) continue;
    if (c.summary) break;
    out.unshift(c);
    if (c.firstGroup) break;
  }
  return out;
}

export function summaryBracket(summary) {
  const group = summaryGroup(summary);
  if (!group.length) return null;
  const left = summary._side === 'left';
  let top = Infinity, bottom = -Infinity, x = left ? Infinity : -Infinity;
  for (const c of group) {
    top = Math.min(top, c._contentY);
    bottom = Math.max(bottom, c._contentY + baseH(c));
    x = left ? Math.min(x, c._contentX) : Math.max(x, c._contentX + c._w);
  }
  x += left ? -SUMMARY_GAP : SUMMARY_GAP;
  return { group, left, top, bottom, x, end: inPoint(summary) };
}

// Dua kurva bracket (atas & bawah) menuju titik masuk node ringkasan.
function summaryEdgeStart(bracket) {
  const sign = bracket.left ? -1 : 1;
  return {
    sign,
    x: sign > 0
      ? Math.min(bracket.x, bracket.end.x - EDGE_CHILD_XCTRL)
      : Math.max(bracket.x, bracket.end.x + EDGE_CHILD_XCTRL),
  };
}

export function summaryEdgePath(bracket, startY) {
  const { sign, x } = summaryEdgeStart(bracket);
  const e = bracket.end;
  return `M ${x} ${startY} L ${x + sign * SUMMARY_XCTRL} ${startY} `
    + `C ${x + sign * 2 * SUMMARY_XCTRL} ${startY} ${x} ${e.y} ${e.x} ${e.y}`;
}

// ---------------------------------------------------------------------------
// Render Canvas 2D
// ---------------------------------------------------------------------------
export function buildIndex(root) {
  const map = new Map();
  (function rec(n) { if (n.id) map.set(n.id, n); for (const c of n.children) rec(c); })(root);
  return map;
}

export function render(ctx, root, opts = {}) {
  walk(root, (n) => {}, null);
  const index = buildIndex(root);
  const vis = new Set(visibleNodes(root));
  walk(root, (node) => { if (vis.has(node)) drawCloud(ctx, node); });
  walk(root, (node) => { if (vis.has(node) && node._parent && !node.summary) drawEdge(ctx, node._parent, node); });
  walk(root, (node) => { if (vis.has(node) && node.summary) drawSummaryEdge(ctx, node); });
  walk(root, (node) => { if (vis.has(node)) drawNode(ctx, node, opts, root); });
  walk(root, (node) => { if (vis.has(node) && !node.folded) drawArrowLinks(ctx, node, index, opts.scale || 1, vis, opts.selectedArrow || null); });
}

// Gambar subtree `node` yang diterjemahkan (tx,ty) — untuk ghost saat drag.
export function renderSubtreeAt(ctx, node, tx, ty, opts = {}) {
  const nodes = subtreeNodes(node);
  const set = new Set(nodes);
  const root = opts.root || node;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 0.75;
  ctx.translate(tx, ty);
  for (const n of nodes) drawCloud(ctx, n);
  for (const n of nodes) if (n._parent && set.has(n._parent) && !n.summary) drawEdge(ctx, n._parent, n);
  for (const n of nodes) drawNode(ctx, n, opts, root);
  ctx.restore();
}

function walk(node, fn, parent) {
  node._parent = parent;
  fn(node);
  for (const c of node.children) walk(c, fn, node);
}

function drawEdge(ctx, parent, node) {
  const s = outPoint(parent);
  const e = inPoint(node);
  const sign = node._side === 'left' ? -1 : 1;
  const model = node.edge || { style: 'bezier', color: null, width: 1 };
  const style = model.style || 'bezier';
  const color = model.color || parent.edge?.color || '#606060';
  const lw = model.width || 1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  if (style === 'linear') {
    // LinearEdgeView
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  } else if (style === 'sharp_linear') {
    // SharpLinearEdgeView: baji segitiga
    const w = lw / 2 + 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + w); ctx.lineTo(e.x, e.y); ctx.lineTo(s.x, s.y - w);
    ctx.closePath(); ctx.fill();
  } else if (style === 'sharp_bezier') {
    // SharpBezierEdgeView: bentuk tetes dari dua kurva
    const one = { x: s.x + sign * EDGE_XCTRL, y: s.y };
    const two = { x: e.x - sign * EDGE_XCTRL, y: e.y };
    const w2 = (lw / 2 + 1) / 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.bezierCurveTo(one.x, one.y, two.x, two.y - w2, e.x, e.y);
    ctx.bezierCurveTo(two.x, two.y + w2, one.x, one.y, s.x, s.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    // BezierEdgeView
    const sx = parent._parent ? sign : 0;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.bezierCurveTo(s.x + sx * EDGE_XCTRL, s.y, e.x - sign * EDGE_CHILD_XCTRL, e.y, e.x, e.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSummaryEdge(ctx, summary) {
  const b = summaryBracket(summary);
  if (!b) return;
  const { sign, x } = summaryEdgeStart(b);
  const m = summary.edge || {};
  const color = m.color || summary._parent?.edge?.color || '#606060';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = m.width || 1;
  for (const y of [b.top, b.bottom]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sign * SUMMARY_XCTRL, y);
    ctx.bezierCurveTo(x + sign * 2 * SUMMARY_XCTRL, y, x, b.end.y, b.end.x, b.end.y);
    ctx.stroke();
  }
  ctx.restore();
}

function nodeCenter(n) {
  return { x: n._contentX + n._w / 2, y: n._contentY + baseH(n) / 2 };
}

// Titik di tepi node pada arah vektor `dir` dari pusat node (ray-rectangle).
function boundaryPoint(n, dirX, dirY) {
  const c = nodeCenter(n);
  const hw = n._w / 2, hh = baseH(n) / 2;
  const tx = dirX !== 0 ? hw / Math.abs(dirX) : Infinity;
  const ty = dirY !== 0 ? hh / Math.abs(dirY) : Infinity;
  const t = Math.min(tx, ty);
  if (!isFinite(t)) return c;
  return { x: c.x + dirX * t, y: c.y + dirY * t };
}

function arrowEndpoints(source, target) {
  const sc = nodeCenter(source), tc = nodeCenter(target);
  const dx = tc.x - sc.x, dy = tc.y - sc.y;
  const d = Math.hypot(dx, dy);
  // Arah selalu dari node sumber ke node tujuan; sisi map (kiri/kanan) tidak
  // mengubah arah ekor/ujung panah. Fallback hanya untuk dua node bertumpuk.
  const ux = d > 1e-6 ? dx / d : (source._side === 'left' ? -1 : 1);
  const uy = d > 1e-6 ? dy / d : 0;
  return {
    s: boundaryPoint(source, ux, uy),
    e: boundaryPoint(target, -ux, -uy),
    ux, uy, nx: -uy, ny: ux,
  };
}

// Geometri panah (dipakai Canvas, SVG, hit-test, dan panel).
export function arrowCurve(source, target, al) {
  const ep = arrowEndpoints(source, target);
  // Recommended control-point distance = jarak titik taut, minimal 40.
  const reach = Math.max(40, Math.hypot(ep.e.x - ep.s.x, ep.e.y - ep.s.y));
  const si = al.startInclination || {};
  const ei = al.endInclination || {};
  const sx = si.x != null ? si.x : reach;
  const sy = si.y != null ? si.y : 0;
  const ex = ei.x != null ? ei.x : reach;
  const ey = ei.y != null ? ei.y : 0;
  // Inclination x = panjang searah sumber->tujuan, y = tekukan tegak lurus.
  // Vektor inclination juga menentukan di edge mana ekor/ujung menempel,
  // sehingga menyeret control point dapat memindahkan tautan ke edge lain.
  const svx = ep.ux * sx + ep.nx * sy;
  const svy = ep.uy * sx + ep.ny * sy;
  const evx = -ep.ux * ex + ep.nx * ey;
  const evy = -ep.uy * ex + ep.ny * ey;
  const s = (svx || svy) ? boundaryPoint(source, svx, svy) : ep.s;
  const e = (evx || evy) ? boundaryPoint(target, evx, evy) : ep.e;
  return {
    ...ep, s, e, reach,
    p3: { x: s.x + svx, y: s.y + svy },
    p4: { x: e.x + evx, y: e.y + evy },
  };
}

function bezierPoint(g, t) {
  const u = 1 - t;
  return {
    x: u * u * u * g.s.x + 3 * u * u * t * g.p3.x + 3 * u * t * t * g.p4.x + t * t * t * g.e.x,
    y: u * u * u * g.s.y + 3 * u * u * t * g.p3.y + 3 * u * t * t * g.p4.y + t * t * t * g.e.y,
  };
}
export function arrowMidpoint(source, target, al) {
  return bezierPoint(arrowCurve(source, target, al), 0.5);
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

// Panah yang paling dekat dengan titik (untuk seleksi klik).
export function hitArrow(root, px, py, tol = 6) {
  const index = buildIndex(root);
  const vis = new Set(visibleNodes(root));
  let best = null, bestD = tol;
  for (const n of vis) {
    for (const al of n.arrowlinks) {
      const target = index.get(al.destination);
      if (!target || !vis.has(target)) continue;
      const g = arrowCurve(n, target, al);
      let prev = g.s;
      for (let i = 1; i <= 32; i++) {
        const p = bezierPoint(g, i / 32);
        const d = distToSegment(px, py, prev, p);
        if (d < bestD) { bestD = d; best = { node: n, link: al, target, distance: d }; }
        prev = p;
      }
    }
  }
  return best;
}

function drawArrowLabel(ctx, text, x, y, align) {
  const w = ctx.measureText(text).width;
  const h = 14;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  roundRect(ctx, left - 2, y - h / 2, w + 4, h, 3);
  ctx.fill();
  ctx.fillStyle = '#333333';
  ctx.fillText(text, x, y);
}

function drawArrowLinks(ctx, node, index, scale = 1, vis = null, selectedArrow = null) {
  const len = 8 / (scale || 1);
  for (const al of node.arrowlinks) {
    const target = index.get(al.destination);
    if (!target || (vis && !vis.has(target))) continue;
    const g = arrowCurve(node, target, al);
    const { s, e, p3, p4 } = g;
    const color = al.color || '#0000ff';
    const sel = selectedArrow && selectedArrow.link === al;
    ctx.save();
    if (sel) {
      ctx.strokeStyle = 'rgba(49,106,197,0.35)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.bezierCurveTo(p3.x, p3.y, p4.x, p4.y, e.x, e.y);
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.bezierCurveTo(p3.x, p3.y, p4.x, p4.y, e.x, e.y);
    ctx.stroke();
    if (al.startArrow && al.startArrow !== 'None') drawArrowHead(ctx, s.x, s.y, Math.atan2(s.y - p3.y, s.x - p3.x), color, len);
    if (al.endArrow && al.endArrow !== 'None') drawArrowHead(ctx, e.x, e.y, Math.atan2(e.y - p4.y, e.x - p4.x), color, len);
    if (al.sourceLabel || al.middleLabel || al.targetLabel) {
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      if (al.sourceLabel) {
        const tw = ctx.measureText(al.sourceLabel).width;
        const lx = p3.x > s.x ? s.x - tw - 4 : s.x + 4;
        const ly = p3.y > s.y ? s.y + 4 + 7 : s.y - 4 - 7;
        drawArrowLabel(ctx, al.sourceLabel, lx, ly, 'left');
      }
      if (al.targetLabel) {
        const tw = ctx.measureText(al.targetLabel).width;
        const lx = p4.x > e.x ? e.x - tw - 4 : e.x + 4;
        const ly = p4.y > e.y ? e.y + 4 + 7 : e.y - 4 - 7;
        drawArrowLabel(ctx, al.targetLabel, lx, ly, 'left');
      }
      if (al.middleLabel) {
        const mid = bezierPoint(g, 0.5);
        ctx.textAlign = 'center';
        drawArrowLabel(ctx, al.middleLabel, mid.x, mid.y, 'center');
      }
    }
    if (sel) {
      // Titik kontrol seperti Freeplane: garis putus-putus ke p3/p4 + pegangannya.
      const r = 4 / (scale || 1);
      ctx.save();
      ctx.setLineDash([4 / (scale || 1), 3 / (scale || 1)]);
      ctx.strokeStyle = 'rgba(49,106,197,0.75)';
      ctx.lineWidth = 1 / (scale || 1);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.lineTo(p3.x, p3.y);
      ctx.moveTo(e.x, e.y); ctx.lineTo(p4.x, p4.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#316ac5';
      ctx.lineWidth = 1.5 / (scale || 1);
      for (const p of [p3, p4]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawArrowHead(ctx, x, y, ang, color, len = 8) {
  const a = Math.PI / 7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - len * Math.cos(ang - a), y - len * Math.sin(ang - a));
  ctx.lineTo(x - len * Math.cos(ang + a), y - len * Math.sin(ang + a));
  ctx.closePath();
  ctx.fill();
}

function subtreeNodes(node) {
  const out = [];
  (function rec(n) { out.push(n); if (!n.folded) for (const c of n.children) rec(c); })(node);
  return out;
}

function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function traceCloud(ctx, hull, d) {
  const n = hull.length;
  let cx = 0, cy = 0;
  for (const p of hull) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  ctx.beginPath();
  ctx.moveTo(hull[0].x, hull[0].y);
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = -(b.y - a.y), ny = (b.x - a.x);
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - nx - cx) ** 2 + (my - ny - cy) ** 2) { nx = -nx; ny = -ny; }
    ctx.quadraticCurveTo(mx + nx * d, my + ny * d, b.x, b.y);
  }
  ctx.closePath();
}

function drawCloud(ctx, node) {
  if (!node.cloud || node.folded) return;
  const pad = 10, d = 10; // getDistanceToConvexHull (level 0) ≈ 40/… di FreeMind
  const pts = [];
  for (const n of subtreeNodes(node)) {
    const x = n._contentX, y = n._contentY, w = n._w, h = n._h;
    pts.push({ x: x - pad, y: y - pad }, { x: x + w + pad, y: y + pad },
             { x: x - pad, y: y + h + pad }, { x: x + w + pad, y: y + h + pad });
  }
  const hull = convexHull(pts);
  if (hull.length < 3) return;
  const color = node.cloud.color || '#ffff33';
  ctx.save();
  ctx.globalAlpha = 0.25; ctx.fillStyle = color;
  traceCloud(ctx, hull, d); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = node.cloud.color || '#d4c400';
  traceCloud(ctx, hull, d); ctx.stroke();
  ctx.restore();
}

// Gaya node mengikuti NodeAdapter.getStyle()/NodeViewFactory:
// - standardnodestyle = 'as_parent' (freemind.properties) → node tanpa gaya
//   eksplisit MEWARISI gaya induknya (induk yang tak bereksplisit mewarisi lagi,
//   hingga root). Jadi node baru (child/sibling) mengikuti gaya node asalnya.
// - standardrootnodestyle = 'fork' (nilai getStyle root), tetapi root SELALU
//   digambar dengan RootMainView (bentuk lonjong/bubble) → visual root 'bubble'.
// - 'combined' = bubble saat folded, fork saat terbuka.
const STANDARD_NODE_STYLE = 'as_parent';
const STANDARD_ROOT_NODE_STYLE = 'fork';

// Padanan NodeAdapter.getStyle(): nilai gaya untuk pewarisan (root = fork).
function styleOf(node, root) {
  if (node === root) return STANDARD_ROOT_NODE_STYLE;
  let st = node.style;
  if (st == null) st = STANDARD_NODE_STYLE;
  if (st === 'as_parent') st = styleOf(node._parent, root);
  if (st === 'combined') st = node.folded ? 'bubble' : 'fork';
  return st === 'bubble' ? 'bubble' : 'fork';
}

// Gaya visual (main view): root selalu RootMainView (bubble), lain dari getStyle().
export function resolvedStyle(node, root) {
  if (node === root) return 'bubble';
  return styleOf(node, root);
}

// NodeAdapter font: NAME/SIZE/BOLD/ITALIC/UNDERLINE.
export function fontString(node) {
  const f = node.font || {};
  const size = f.size || 14;
  const style = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}`;
  const fam = f.name || 'sans-serif';
  return `${style}${size}px ${fam}`;
}

// Ikon node ala NodeView.updateIcons: stateIcon(catatan) → ikon BUILTIN → ikon link.
// executableByExtension (Tools.java): ekstensi {exe,com,vbs,bat,lnk}; getExtension = teks setelah '.' terakhir.
const EXECUTABLE_EXT = new Set(['exe', 'com', 'vbs', 'bat', 'lnk']);
function extensionOf(s) {
  const i = s.lastIndexOf('.');
  return i > 0 && i < s.length - 1 ? s.slice(i + 1).toLowerCase().trim() : '';
}
function linkIconKey(link) {
  if (!link) return null;
  if (link.startsWith('#')) return 'LinkLocal';
  if (link.startsWith('mailto:')) return 'Mail';
  if (EXECUTABLE_EXT.has(extensionOf(link))) return 'Executable';
  return 'Link';
}

export function iconKeys(node) {
  const out = [];
  if (node.note) out.push('knotes');
  for (const ic of node.icons) out.push(ic);
  const li = linkIconKey(node.link);
  if (li) out.push(li);
  return out;
}

export function iconRowWidth(node) { return iconKeys(node).length * ICON_SIZE; }

// Visibilitas atribut (AttributeTableLayoutModel): 'all'|'extended', 'selected', 'hide'.
export function attrVisible(node, mode, selected, selection) {
  if (!node.attrs || node.attrs.length === 0) return false;
  if (mode === 'hide') return false;
  if (mode === 'selected') return node === selected || !!(selection && selection.has(node));
  return true;
}

function drawNode(ctx, node, opts, root) {
  const x = node._contentX, y = node._contentY, w = node._w, h = baseH(node);
  const style = node === root ? 'root' : resolvedStyle(node, root);
  const sel = opts.selectedNode === node || (opts.selection && opts.selection.has(node));
  ctx.save();
  ctx.font = fontString(node);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (style === 'root') {
    ctx.fillStyle = node.bg || (sel ? '#cfe3ff' : '#eef2f7');
    ctx.strokeStyle = '#808080';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else if (style === 'bubble') {
    ctx.fillStyle = node.bg || (sel ? '#cfe3ff' : '#ffffff');
    ctx.strokeStyle = node.color || '#404040';
    roundRect(ctx, x, y, w, h, 10); ctx.fill(); ctx.stroke();
  } else {
    if (node.bg) { ctx.fillStyle = node.bg; ctx.fillRect(x, y, w, h); }
    if (sel) {
      ctx.fillStyle = '#cfe3ff';
      roundRect(ctx, x - 4, y - 1, w + 8, h + 2, 5); ctx.fill();
    }
    ctx.strokeStyle = node.color || '#404040';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
  }

  // Teks + ikon dalam satu baris; ikon di sisi MENGHADAP root
  // (NodeView.updateIconPosition: isLeft ? LEADING : TRAILING → kanan: ikon di kiri,
  //  kiri: ikon di kanan).
  const keys = iconKeys(node);
  const iconW = keys.length * ICON_SIZE;
  const areaLeft = node._side === 'left' ? x : x + iconW;
  const areaRight = node._side === 'left' ? x + w - iconW : x + w;
  const align = String(node.textAlign || '').toLowerCase();
  let textX;
  if (align === 'left') { ctx.textAlign = 'left'; textX = areaLeft + 4; }
  else if (align === 'right') { ctx.textAlign = 'right'; textX = areaRight - 4; }
  else { ctx.textAlign = 'center'; textX = (areaLeft + areaRight) / 2; }
  const lines = textLines(node);
  const lineH = lineHeight(node);
  let ly = y + (h - lines.length * lineH) / 2 + lineH / 2;
  ctx.fillStyle = node.color || '#101010';
  for (const line of lines) {
    ctx.fillText(line, textX, ly);
    if (node.font?.underline) {
      const tw = ctx.measureText(line).width;
      const lx = align === 'left' ? textX : align === 'right' ? textX - tw : textX - tw / 2;
      const uy = ly + (node.font.size || 14) * 0.55;
      ctx.strokeStyle = node.color || '#101010';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx, uy); ctx.lineTo(lx + tw, uy); ctx.stroke();
    }
    ly += lineH;
  }
  if (opts.images && iconW) {
    let cx = node._side === 'left' ? x + w - iconW : x;
    const iy = y + (h - ICON_SIZE) / 2;
    for (const k of keys) {
      const img = opts.images.get(k);
      if (img && img.complete && img.naturalWidth) ctx.drawImage(img, cx, iy, ICON_SIZE, ICON_SIZE);
      cx += ICON_SIZE;
    }
  }
  if (node.children.length) drawFoldIndicator(ctx, node);
  if (node._attrRows) drawAttrBlock(ctx, node, y + baseH(node));
  ctx.restore();
}

// Blok atribut (AttributeView): tabel dua kolom nama|nilai di bawah kotak node.
function drawAttrBlock(ctx, node, yTop) {
  const x = node._contentX, w = node._w, rows = node._attrsVisible || [];
  const n = rows.length;
  if (!n) return;
  const colW = node._attrColW || w / 2;
  ctx.save();
  ctx.font = ATTR_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 1;
  ctx.fillRect(x, yTop, w, n * ATTR_ROW_H + ATTR_PAD);
  ctx.strokeRect(x, yTop, w, n * ATTR_ROW_H + ATTR_PAD);
  ctx.strokeStyle = '#e0e0e0';
  ctx.beginPath();
  ctx.moveTo(x + colW, yTop); ctx.lineTo(x + colW, yTop + n * ATTR_ROW_H + ATTR_PAD);
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const ry = yTop + ATTR_PAD / 2 + i * ATTR_ROW_H;
    if (i) {
      ctx.strokeStyle = '#eee';
      ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x + w, ry); ctx.stroke();
    }
    ctx.fillStyle = '#333';
    ctx.font = 'bold ' + ATTR_FONT;
    ctx.fillText(rows[i].name, x + 3, ry + ATTR_ROW_H / 2);
    ctx.font = ATTR_FONT;
    ctx.fillStyle = '#101010';
    ctx.fillText(rows[i].value, x + colW + 3, ry + ATTR_ROW_H / 2);
  }
  ctx.restore();
}

// NodeFoldingComponent: lingkaran kecil di titik-keluar node, garis horizontal
// selalu, garis vertikal saat folded.
function drawFoldIndicator(ctx, node) {
  const p = outPoint(node);
  const r = FOLD_SYMBOL / 2;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = node.edge?.color || '#606060';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
  if (node.folded) { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r); }
  ctx.stroke();
  ctx.restore();
}


function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Semua node terlihat (folded parent menyembunyikan anak) dalam urutan DFS.
export function visibleNodes(root) {
  const out = [];
  (function rec(n) {
    out.push(n);
    if (!n.folded) for (const c of n.children) rec(c);
  })(root);
  return out;
}

// Navigasi keyboard spasial: node terdekat pada arah (kx,ky) ∈ {-1,0,1}.
// Skor = jarak searah + 3×jarak menyimpang, jadi node yang lurus diprioritaskan.
export function findNeighbor(root, from, kx, ky) {
  if (!from) return null;
  const cx = from._contentX + (from._w || 0) / 2;
  const cy = from._contentY + (from._h || 0) / 2;
  let best = null, bestScore = Infinity;
  for (const n of visibleNodes(root)) {
    if (n === from) continue;
    const dx = n._contentX + (n._w || 0) / 2 - cx;
    const dy = n._contentY + (n._h || 0) / 2 - cy;
    const primary = kx ? dx * kx : dy * ky;
    if (primary <= 1) continue;
    const secondary = kx ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 3;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

export const HIT_MARGIN = 4;

export function hitTest(root, px, py) {
  let best = null, bestArea = Infinity;
  for (const n of visibleNodes(root)) {
    const x = n._contentX - HIT_MARGIN, y = n._contentY - HIT_MARGIN;
    const w = n._w + HIT_MARGIN * 2, h = n._h + HIT_MARGIN * 2;
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      const area = n._w * n._h;
      if (area < bestArea) { bestArea = area; best = n; }
    }
  }
  return best;
}

export function boundingBox(root) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of visibleNodes(root)) {
    minX = Math.min(minX, n._contentX); minY = Math.min(minY, n._contentY);
    maxX = Math.max(maxX, n._contentX + n._w); maxY = Math.max(maxY, n._contentY + n._h);
  }
  return { minX, minY, maxX, maxY };
}

// Penanda lipat (NodeFoldingComponent) di titik-keluar node.
export function hitFold(root, px, py) {
  const r = FOLD_SYMBOL / 2 + 2;
  for (const n of visibleNodes(root)) {
    if (!n.children.length) continue;
    const p = outPoint(n);
    if ((px - p.x) ** 2 + (py - p.y) ** 2 <= r * r) return n;
  }
  return null;
}

// Node yang punya LINK dan memuat titik (untuk kursor tangan / Ctrl+klik).
export function hitLink(root, px, py) {
  let best = null, bestArea = Infinity;
  for (const n of visibleNodes(root)) {
    if (!n.link) continue;
    const x = n._contentX - HIT_MARGIN, y = n._contentY - HIT_MARGIN;
    const w = n._w + HIT_MARGIN * 2, h = n._h + HIT_MARGIN * 2;
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      const area = n._w * n._h;
      if (area < bestArea) { bestArea = area; best = n; }
    }
  }
  return best;
}

export function foldAll(root, folded) {
  (function rec(n) { if (n.children.length) n.folded = !!folded; for (const c of n.children) rec(c); })(root);
}

// Wariskan format dari node aktif ke node baru (child/sibling): gaya, warna,
// latar, rata teks, font (termasuk ukuran), dan edge. Objek disalin agar tidak berbagi referensi.
export function inheritVisualAttributes(target, source) {
  if (!source) return target;
  target.style = source.style ?? null;
  target.color = source.color ?? null;
  target.bg = source.bg ?? null;
  target.textAlign = source.textAlign ?? null;
  target.font = source.font ? { ...source.font } : null;
  target.edge = source.edge ? { ...source.edge } : null;
  return target;
}

// NewChildAction (NEW_SIBLING_BEHIND): saudara baru disisipkan tepat setelah
// node aktif, bukan di akhir daftar anak.
export function insertSiblingAfter(parent, sibling, node) {
  if (!parent || !sibling || !node) return false;
  const index = parent.children.indexOf(sibling);
  if (index < 0) return false;
  parent.children.splice(index + 1, 0, node);
  return true;
}

// NodeUpAction/NodeDownAction: geser node terpilih satu posisi di antara
// saudara pada sisi yang sama (multi-seleksi harus berurutan, wrap-around).
// Mengembalikan array children baru atau null bila tidak ada perubahan.
export function reorderSiblings(nodes, direction) {
  const selected = (nodes || []).filter((n) => n && n._parent && !n.summary);
  if (!selected.length) return null;
  const parent = selected[0]._parent;
  const side = selected[0]._side;
  if (selected.some((n) => n._parent !== parent || n._side !== side)) return null;
  const sibs = parent.children.filter((c) => c._side === side && !c.summary);
  const idxs = selected.map((n) => sibs.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (idxs.length !== selected.length || new Set(idxs).size !== idxs.length) return null;
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] !== idxs[i - 1] + 1) return null;
  }
  const start = idxs[0], end = idxs[idxs.length - 1];
  const seg = sibs.slice(start, end + 1);
  let next;
  if (direction < 0) {
    next = start > 0
      ? [...sibs.slice(0, start - 1), ...seg, sibs[start - 1], ...sibs.slice(end + 1)]
      : [...sibs.slice(end + 1), ...seg];
  } else {
    next = end < sibs.length - 1
      ? [...sibs.slice(0, start), sibs[end + 1], ...seg, ...sibs.slice(end + 2)]
      : [...seg, ...sibs.slice(0, start)];
  }
  if (next.every((n, i) => n === sibs[i])) return null;
  const positions = sibs.map((s) => parent.children.indexOf(s));
  const children = parent.children.slice();
  positions.forEach((p, i) => { children[p] = next[i]; });
  return children;
}

// Klon subtree (hanya model; tanpa field runtime _parent/_contentX/…).
export function cloneSubtree(node) {
  const copy = createNode(node.text);
  copy.folded = node.folded;
  copy.position = node.position;
  copy.style = node.style;
  copy.summary = node.summary;
  copy.firstGroup = node.firstGroup;
  copy.color = node.color;
  copy.bg = node.bg;
  copy.textAlign = node.textAlign;
  copy.id = node.id || null;
  copy.link = node.link || null;
  copy.edge = node.edge ? { ...node.edge } : null;
  copy.font = node.font ? { ...node.font } : null;
  copy.icons = node.icons.slice();
  copy.rich = node.rich;
  copy.note = node.note;
  copy.cloud = node.cloud ? { ...node.cloud } : null;
  copy.arrowlinks = node.arrowlinks.map((a) => ({ ...a }));
  copy.attrs = node.attrs.map((a) => ({ ...a }));
  copy.hGap = node.hGap;
  copy.vGap = node.vGap;
  copy.shiftY = node.shiftY;
  copy.children = node.children.map(cloneSubtree);
  return copy;
}

// ---------------------------------------------------------------------------
// Node motion (NodeMotionListenerView / MindMapNodeMotionListener): pegangan
// oval di sisi-dalam node untuk memindah koordinat relatif (HGAP, VSHIFT).
// ---------------------------------------------------------------------------
export function handleRect(node) {
  const y = node._contentY, h = baseH(node);
  if (node._side === 'left') return { x: node._contentX + node._w, y, w: HANDLE_W, h };
  return { x: node._contentX - HANDLE_W, y, w: HANDLE_W, h };
}

export function hitHandle(root, px, py) {
  let best = null, bestH = Infinity;
  for (const n of visibleNodes(root)) {
    if (!n._parent) continue; // root tak punya pegangan
    const r = handleRect(n);
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      if (r.h < bestH) { bestH = r.h; best = n; }
    }
  }
  return best;
}

// Oval pegangan; merah bila HGap <= 0 (NodeMotionListenerView.paintComponent).
export function drawHandle(ctx, node) {
  const r = handleRect(node);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = node.hGap <= 0 ? '#ff0000' : '#000000';
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Renderer SVG (headless, tanpa dependensi) — cermin dari render() Canvas.
// ---------------------------------------------------------------------------
const escXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function cloudPathD(hull, d) {
  const n = hull.length;
  let cx = 0, cy = 0;
  for (const p of hull) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let s = `M ${hull[0].x} ${hull[0].y}`;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = -(b.y - a.y), ny = (b.x - a.x);
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - nx - cx) ** 2 + (my - ny - cy) ** 2) { nx = -nx; ny = -ny; }
    s += ` Q ${mx + nx * d} ${my + ny * d} ${b.x} ${b.y}`;
  }
  return s + ' Z';
}

function arrowHeadPoints(x, y, ang, len) {
  const a = Math.PI / 7;
  const p1 = [x, y];
  const p2 = [x - len * Math.cos(ang - a), y - len * Math.sin(ang - a)];
  const p3 = [x - len * Math.cos(ang + a), y - len * Math.sin(ang + a)];
  return [p1, p2, p3].map(([px, py]) => `${px},${py}`).join(' ');
}

export function renderSVG(root, opts = {}) {
  walk(root, () => {}, null);
  const index = buildIndex(root);
  const vis = new Set(visibleNodes(root));
  const bb = boundingBox(root);
  const pad = opts.pad ?? SPACE_AROUND;
  const W = bb.maxX - bb.minX + 2 * pad, H = bb.maxY - bb.minY + 2 * pad;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.minX - pad} ${bb.minY - pad} ${W} ${H}" font-family="sans-serif" font-size="14">`];

  walk(root, (n) => {
    if (!vis.has(n) || !n.cloud || n.folded) return;
    const pts = [];
    for (const x of subtreeNodes(n)) {
      const px = x._contentX, py = x._contentY, w = x._w, h = x._h;
      pts.push({ x: px - 10, y: py - 10 }, { x: px + w + 10, y: py + 10 },
               { x: px - 10, y: py + h + 10 }, { x: px + w + 10, y: py + h + 10 });
    }
    const hull = convexHull(pts);
    if (hull.length < 3) return;
    out.push(`<path d="${cloudPathD(hull, 10)}" fill="${n.cloud.color || '#ffff33'}" fill-opacity="0.25" stroke="${n.cloud.color || '#d4c400'}"/>`);
  });

  walk(root, (n) => {
    if (!vis.has(n) || !n._parent || n.summary) return;
    const parent = n._parent;
    const s = outPoint(parent), e = inPoint(n);
    const sign = n._side === 'left' ? -1 : 1;
    const m = n.edge || { style: 'bezier', color: null, width: 1 };
    const stroke = m.color || parent.edge?.color || '#606060';
    const st = m.style || 'bezier';
    const sx = parent._parent ? sign : 0;
    let d;
    if (st === 'linear') d = `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
    else if (st === 'sharp_linear') {
      const w = (m.width || 1) / 2 + 1;
      d = `M ${s.x} ${s.y + w} L ${e.x} ${e.y} L ${s.x} ${s.y - w} Z`;
    } else if (st === 'sharp_bezier') {
      const w2 = ((m.width || 1) / 2 + 1) / 2;
      const one = { x: s.x + sign * EDGE_XCTRL, y: s.y }, two = { x: e.x - sign * EDGE_XCTRL, y: e.y };
      d = `M ${s.x} ${s.y} C ${one.x} ${one.y} ${two.x} ${two.y - w2} ${e.x} ${e.y} C ${two.x} ${two.y + w2} ${one.x} ${one.y} ${s.x} ${s.y} Z`;
    } else d = `M ${s.x} ${s.y} C ${s.x + sx * EDGE_XCTRL} ${s.y} ${e.x - sign * EDGE_CHILD_XCTRL} ${e.y} ${e.x} ${e.y}`;
    out.push(`<path d="${d}" fill="${st.startsWith('sharp') ? stroke : 'none'}" stroke="${stroke}" stroke-width="${m.width || 1}"/>`);
  });

  walk(root, (n) => {
    if (!vis.has(n) || !n.summary) return;
    const b = summaryBracket(n);
    if (!b) return;
    const m = n.edge || {};
    const stroke = m.color || n._parent?.edge?.color || '#606060';
    for (const y of [b.top, b.bottom]) {
      out.push(`<path d="${summaryEdgePath(b, y)}" fill="none" stroke="${stroke}" stroke-width="${m.width || 1}"/>`);
    }
  });

  walk(root, (n) => {
    if (!vis.has(n) || n.folded) return;
    for (const al of n.arrowlinks) {
      const target = index.get(al.destination);
      if (!target || !vis.has(target)) continue;
      const { s, e, p3, p4 } = arrowCurve(n, target, al);
      const color = al.color || '#0000ff';
      out.push(`<path d="M ${s.x} ${s.y} C ${p3.x} ${p3.y} ${p4.x} ${p4.y} ${e.x} ${e.y}" fill="none" stroke="${color}"/>`);
      if (al.startArrow && al.startArrow !== 'None') out.push(`<polygon points="${arrowHeadPoints(s.x, s.y, Math.atan2(s.y - p3.y, s.x - p3.x), 8)}" fill="${color}"/>`);
      if (al.endArrow && al.endArrow !== 'None') out.push(`<polygon points="${arrowHeadPoints(e.x, e.y, Math.atan2(e.y - p4.y, e.x - p4.x), 8)}" fill="${color}"/>`);
      const label = (text, x, y, anchor) => {
        if (!text) return;
        const w = String(text).length * 6.5 + 4;
        const rx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        out.push(`<rect x="${rx - 2}" y="${y - 8}" width="${w}" height="16" rx="3" fill="#ffffff" fill-opacity="0.9"/>`);
        out.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central" font-size="12" fill="#333333">${escXml(text)}</text>`);
      };
      const mid = bezierPoint(arrowCurve(n, target, al), 0.5);
      if (al.middleLabel) label(al.middleLabel, mid.x, mid.y, 'middle');
      if (al.sourceLabel) {
        const tw = String(al.sourceLabel).length * 6.5;
        const lx = p3.x > s.x ? s.x - tw - 4 : s.x + 4;
        const ly = p3.y > s.y ? s.y + 4 + 7 : s.y - 4 - 7;
        label(al.sourceLabel, lx, ly, 'start');
      }
      if (al.targetLabel) {
        const tw = String(al.targetLabel).length * 6.5;
        const lx = p4.x > e.x ? e.x - tw - 4 : e.x + 4;
        const ly = p4.y > e.y ? e.y + 4 + 7 : e.y - 4 - 7;
        label(al.targetLabel, lx, ly, 'start');
      }
    }
  });

  walk(root, (n) => {
    if (!vis.has(n)) return;
    const x = n._contentX, y = n._contentY, w = n._w, h = baseH(n);
    const style = n === root ? 'root' : resolvedStyle(n, root);
    const sel = opts.selectedNode === n;
    if (style === 'root') {
      out.push(`<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${n.bg || (sel ? '#cfe3ff' : '#eef2f7')}" stroke="#808080"/>`);
    } else if (style === 'bubble') {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ry="10" fill="${n.bg || (sel ? '#cfe3ff' : '#ffffff')}" stroke="${n.color || '#404040'}"/>`);
    } else {
      if (sel) out.push(`<rect x="${x - 4}" y="${y - 1}" width="${w + 8}" height="${h + 2}" rx="5" fill="#cfe3ff"/>`);
      out.push(`<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${n.color || '#404040'}"/>`);
    }
    const fw = n.font?.bold ? ' font-weight="bold"' : '';
    const fs = n.font?.italic ? ' font-style="italic"' : '';
    const fz = n.font?.size ? ` font-size="${n.font.size}"` : '';
    const keys = iconKeys(n);
    const iconW = keys.length * ICON_SIZE;
    const areaLeft = n._side === 'left' ? x : x + iconW;
    const areaRight = n._side === 'left' ? x + w - iconW : x + w;
    const align = String(n.textAlign || '').toLowerCase();
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const textX = align === 'left' ? areaLeft + 4 : align === 'right' ? areaRight - 4 : (areaLeft + areaRight) / 2;
    const lines = textLines(n);
    const lineH = lineHeight(n);
    const y0 = y + (h - lines.length * lineH) / 2 + lineH / 2;
    lines.forEach((line, i) => {
      out.push(`<text x="${textX}" y="${y0 + i * lineH}" text-anchor="${anchor}" dominant-baseline="central" fill="${n.color || '#101010'}"${fw}${fs}${fz}>${escXml(line)}</text>`);
    });
    let cx = n._side === 'left' ? x + w - iconW : x;
    for (const k of keys) {
      out.push(`<image href="icons/${k}.png" x="${cx}" y="${y + (h - ICON_SIZE) / 2}" width="${ICON_SIZE}" height="${ICON_SIZE}"/>`);
      cx += ICON_SIZE;
    }
    if (n.children.length) {
      const p = outPoint(n), r = FOLD_SYMBOL / 2;
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#ffffff" stroke="${n.edge?.color || '#606060'}"/>`);
      out.push(`<line x1="${p.x - r}" y1="${p.y}" x2="${p.x + r}" y2="${p.y}" stroke="${n.edge?.color || '#606060'}"/>`);
      if (n.folded) out.push(`<line x1="${p.x}" y1="${p.y - r}" x2="${p.x}" y2="${p.y + r}" stroke="${n.edge?.color || '#606060'}"/>`);
    }
    if (n._attrRows) {
      const rows = n._attrsVisible || []; const yTop = y + h; const colW = n._attrColW || w / 2;
      out.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${rows.length * ATTR_ROW_H + ATTR_PAD}" fill="#ffffff" stroke="#c0c0c0"/>`);
      out.push(`<line x1="${x + colW}" y1="${yTop}" x2="${x + colW}" y2="${yTop + rows.length * ATTR_ROW_H + ATTR_PAD}" stroke="#e0e0e0"/>`);
      rows.forEach((r, i) => {
        const ry = yTop + ATTR_PAD / 2 + i * ATTR_ROW_H + ATTR_ROW_H / 2;
        out.push(`<text x="${x + 3}" y="${ry}" dominant-baseline="central" font-size="11" font-weight="bold" fill="#333">${escXml(r.name)}</text>`);
        out.push(`<text x="${x + colW + 3}" y="${ry}" dominant-baseline="central" font-size="11" fill="#101010">${escXml(r.value)}</text>`);
      });
    }
  });

  out.push('</svg>');
  return out.join('\n');
}
