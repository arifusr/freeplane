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
    color: null, bg: null, edge: null, font: null,
    icons: [], rich: null, note: null, cloud: null, arrowlinks: [], attrs: [], children: [],
    hGap: HGAP, vGap: VGAP, shiftY: 0,
  };
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
        });
        break;
      case 'richcontent':
        if (c.attrs.TYPE === 'NOTE') node.note = c.raw; else node.rich = c.raw;
        break;
      case 'attribute': node.attrs.push({ name: c.attrs.NAME || '', value: c.attrs.VALUE || '' }); break;
      case 'node': node.children.push(buildNode(c)); break;
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// Emitter .mm (tulis atribut non-default, urutan ala NodeAdapter.save)
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
let measureFn = (node) => ({ w: Math.max(20, node.text.length * 7 + 12), h: 16 + 4 });
export function setMeasure(fn) { measureFn = fn; }

export function layout(root) {
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
  const rh = open ? subtreeHeight(node._right, node.vGap) : 0;
  const lh = open ? subtreeHeight(node._left, node.vGap) : 0;
  // HGap milik anak (jarak anak dari induk), sesuai NodeViewLayoutAdapter.getChildHorizontalShift.
  const rExt = open && node._right.length ? Math.max(...node._right.map((c) => c.hGap + c._bw)) : 0;
  const lExt = open && node._left.length ? Math.max(...node._left.map((c) => c.hGap + c._bw)) : 0;
  node._bw = lExt + node._w + rExt;
  node._bh = Math.max(node._h, rh, lh);
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
    const list = node[`_${side}`];
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
  walk(root, (node) => { if (vis.has(node) && node._parent) drawEdge(ctx, node._parent, node); });
  walk(root, (node) => { if (vis.has(node)) drawNode(ctx, node, opts, root); });
  walk(root, (node) => { if (vis.has(node) && !node.folded) drawArrowLinks(ctx, node, index, opts.scale || 1, vis); });
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
  for (const n of nodes) if (n._parent && set.has(n._parent)) drawEdge(ctx, n._parent, n);
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

function drawArrowLinks(ctx, node, index, scale = 1, vis = null) {
  const len = 8 / (scale || 1);
  for (const al of node.arrowlinks) {
    const target = index.get(al.destination);
    if (!target || (vis && !vis.has(target))) continue;
    const s = outPoint(node);
    const e = inPoint(target);
    const sSign = node._side === 'left' ? -1 : 1;
    const tSign = target._side === 'left' ? -1 : 1;
    const dist = Math.hypot(e.x - s.x, e.y - s.y) || 30;
    // Control point 3/4 (ArrowLinkView: p3 = p1 + sign·inclination).
    const si = al.startInclination || { x: dist, y: 0 };
    const ei = al.endInclination || { x: dist, y: 0 };
    const p3 = { x: s.x + sSign * si.x, y: s.y + si.y };
    const p4 = { x: e.x + tSign * ei.x, y: e.y + ei.y };
    ctx.save();
    ctx.strokeStyle = al.color || '#0000ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.bezierCurveTo(p3.x, p3.y, p4.x, p4.y, e.x, e.y);
    ctx.stroke();
    if (al.startArrow && al.startArrow !== 'None') drawArrowHead(ctx, s.x, s.y, Math.atan2(s.y - p3.y, s.x - p3.x), al.color || '#0000ff', len);
    if (al.endArrow && al.endArrow !== 'None') drawArrowHead(ctx, e.x, e.y, Math.atan2(e.y - p4.y, e.x - p4.x), al.color || '#0000ff', len);
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

// Gaya node mengikuti NodeAdapter.getStyle(): root pakai standardrootnodestyle,
// node lain pakai standardnodestyle; 'as_parent' mewarisi induk; 'combined'
// jadi bubble saat folded, fork saat terbuka.
const STANDARD_NODE_STYLE = 'fork';
const STANDARD_ROOT_NODE_STYLE = 'bubble';

function resolvedStyle(node, root) {
  if (node === root) return STANDARD_ROOT_NODE_STYLE;
  let st = node.style;
  if (st == null) st = STANDARD_NODE_STYLE;
  else if (st === 'as_parent') st = resolvedStyle(node._parent, root);
  if (st === 'combined') st = node.folded ? 'bubble' : 'fork';
  return st === 'bubble' ? 'bubble' : 'fork';
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
  const textX = node._side === 'left' ? x + (w - iconW) / 2 : x + iconW + (w - iconW) / 2;
  ctx.fillStyle = node.color || '#101010';
  ctx.fillText(node.text, textX, y + h / 2);
  if (node.font?.underline) {
    const tw = ctx.measureText(node.text).width;
    const uy = y + h / 2 + (node.font.size || 14) * 0.55;
    ctx.strokeStyle = node.color || '#101010';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(textX - tw / 2, uy); ctx.lineTo(textX + tw / 2, uy); ctx.stroke();
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

// Klon subtree (hanya model; tanpa field runtime _parent/_contentX/…).
export function cloneSubtree(node) {
  const copy = createNode(node.text);
  copy.folded = node.folded;
  copy.position = node.position;
  copy.style = node.style;
  copy.color = node.color;
  copy.bg = node.bg;
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
    if (!vis.has(n) || !n._parent) return;
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
    if (!vis.has(n) || n.folded) return;
    for (const al of n.arrowlinks) {
      const target = index.get(al.destination);
      if (!target || !vis.has(target)) continue;
      const s = outPoint(n), e = inPoint(target);
      const sSign = n._side === 'left' ? -1 : 1;
      const tSign = target._side === 'left' ? -1 : 1;
      const dist = Math.hypot(e.x - s.x, e.y - s.y) || 30;
      const si = al.startInclination || { x: dist, y: 0 };
      const ei = al.endInclination || { x: dist, y: 0 };
      const p3 = { x: s.x + sSign * si.x, y: s.y + si.y };
      const p4 = { x: e.x + tSign * ei.x, y: e.y + ei.y };
      const color = al.color || '#0000ff';
      out.push(`<path d="M ${s.x} ${s.y} C ${p3.x} ${p3.y} ${p4.x} ${p4.y} ${e.x} ${e.y}" fill="none" stroke="${color}"/>`);
      if (al.startArrow && al.startArrow !== 'None') out.push(`<polygon points="${arrowHeadPoints(s.x, s.y, Math.atan2(s.y - p3.y, s.x - p3.x), 8)}" fill="${color}"/>`);
      if (al.endArrow && al.endArrow !== 'None') out.push(`<polygon points="${arrowHeadPoints(e.x, e.y, Math.atan2(e.y - p4.y, e.x - p4.x), 8)}" fill="${color}"/>`);
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
    const textX = n._side === 'left' ? x + (w - iconW) / 2 : x + iconW + (w - iconW) / 2;
    out.push(`<text x="${textX}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" fill="${n.color || '#101010'}"${fw}${fs}${fz}>${escXml(n.text)}</text>`);
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
