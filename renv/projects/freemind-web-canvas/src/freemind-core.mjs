// freemind-web-canvas — inti reimplementasi FreeMind (model, .mm, layout, render)
// Referensi algoritma: freemind/freemind/{modes,view/mindmapview} (commit a3674b0).
// Lihat catatan renv: "Spesifikasi model node & format .mm (presisi)", dst.

export const SPACE_AROUND = 50; // NodeView.SPACE_AROUND
export const VGAP = 3;          // NodeAdapter.VGAP
export const HGAP = 20;         // NodeAdapter.HGAP
export const EDGE_XCTRL = 12;   // BezierEdgeView.XCTRL
export const EDGE_CHILD_XCTRL = 20; // BezierEdgeView.CHILD_XCTRL

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
  const rh = subtreeHeight(node._right, node.vGap);
  const lh = subtreeHeight(node._left, node.vGap);
  const rw = node._right.length ? Math.max(...node._right.map((c) => c._bw)) : 0;
  const lw = node._left.length ? Math.max(...node._left.map((c) => c._bw)) : 0;
  node._bw = (lw ? lw + node.hGap : 0) + node._w + (rw ? node.hGap + rw : 0);
  node._bh = Math.max(node._h, rh, lh);
  node._cx = lw ? lw + node.hGap : 0;
  node._cy = (node._bh - node._h) / 2;
}

function place(node) {
  for (const side of ['right', 'left']) {
    const list = node[`_${side}`];
    const total = subtreeHeight(list, node.vGap);
    let y = node._contentY + node._h / 2 - total / 2;
    for (const c of list) {
      y += c.shiftY;
      const bx = side === 'right'
        ? node._contentX + node._w + node.hGap
        : node._contentX - node.hGap - c._bw;
      c._contentX = bx + c._cx;
      c._contentY = y + c._cy;
      place(c);
      y += c._bh + node.vGap;
    }
  }
}

// Titik masuk/keluar node (analog MainView getLeft/Center/RightPoint).
export function inPoint(node) {
  if (node._side === 'left') return { x: node._contentX + node._w, y: node._contentY + node._h / 2 };
  return { x: node._contentX, y: node._contentY + node._h / 2 };
}
export function outPoint(node) {
  if (node._side === 'left') return { x: node._contentX, y: node._contentY + node._h / 2 };
  return { x: node._contentX + node._w, y: node._contentY + node._h / 2 };
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
  const sel = opts.selectedNode;
  walk(root, (n) => {}, null);
  const index = buildIndex(root);
  walk(root, (node) => drawCloud(ctx, node));
  walk(root, (node) => { if (node._parent && !node._parent.folded) drawEdge(ctx, node._parent, node); });
  walk(root, (node) => drawNode(ctx, node, sel, root));
  walk(root, (node) => { if (!node.folded) drawArrowLinks(ctx, node, index, opts.scale || 1); });
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
  ctx.save();
  ctx.strokeStyle = model.color || parent.edge?.color || '#606060';
  ctx.lineWidth = model.width || 1;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  if (style.includes('bezier')) {
    const sx = parent._parent ? sign : 0;
    ctx.bezierCurveTo(s.x + sx * EDGE_XCTRL, s.y, e.x - sign * EDGE_CHILD_XCTRL, e.y, e.x, e.y);
  } else {
    ctx.lineTo(e.x, e.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawArrowLinks(ctx, node, index, scale = 1) {
  const len = 8 / (scale || 1);
  for (const al of node.arrowlinks) {
    const target = index.get(al.destination);
    if (!target) continue;
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

function resolvedStyle(node, root) {
  let st = node.style;
  if (st === 'as_parent' || st == null) st = node === root ? 'bubble' : (node._parent ? resolvedStyle(node._parent, root) : 'fork');
  if (st === 'combined') st = node.folded ? 'bubble' : 'fork';
  return st || 'fork';
}

function drawNode(ctx, node, sel, root) {
  const x = node._contentX, y = node._contentY, w = node._w, h = node._h;
  const style = node === root ? 'root' : resolvedStyle(node, root);
  ctx.save();
  ctx.font = `${node.font?.bold ? 'bold ' : ''}${node.font?.italic ? 'italic ' : ''}14px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (style === 'root') {
    ctx.fillStyle = node.bg || (sel === node ? '#cfe3ff' : '#eef2f7');
    ctx.strokeStyle = '#808080';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else if (style === 'bubble') {
    ctx.fillStyle = node.bg || (sel === node ? '#cfe3ff' : '#ffffff');
    ctx.strokeStyle = node.color || '#404040';
    roundRect(ctx, x, y, w, h, 10); ctx.fill(); ctx.stroke();
  } else {
    if (node.bg) { ctx.fillStyle = node.bg; ctx.fillRect(x, y, w, h); }
    ctx.strokeStyle = node.color || '#404040';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
  }
  ctx.fillStyle = node.color || '#101010';
  ctx.fillText(node.text, x + w / 2, y + h / 2);
  if (node.folded && node.children.length) {
    ctx.fillStyle = '#404040';
    ctx.beginPath();
    ctx.arc(node._side === 'left' ? x : x + w, y + h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
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

export function hitTest(root, px, py) {
  let best = null;
  for (const n of visibleNodes(root)) {
    const x = n._contentX - SPACE_AROUND, y = n._contentY - SPACE_AROUND;
    const w = n._w + SPACE_AROUND * 2, h = n._h + SPACE_AROUND * 2;
    if (px >= x && px <= x + w && py >= y && py <= y + h) best = n;
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
  const bb = boundingBox(root);
  const pad = opts.pad ?? SPACE_AROUND;
  const W = bb.maxX - bb.minX + 2 * pad, H = bb.maxY - bb.minY + 2 * pad;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.minX - pad} ${bb.minY - pad} ${W} ${H}" font-family="sans-serif" font-size="14">`];

  walk(root, (n) => {
    if (!n.cloud || n.folded) return;
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
    if (!n._parent || n._parent.folded) return;
    const parent = n._parent;
    const s = outPoint(parent), e = inPoint(n);
    const sign = n._side === 'left' ? -1 : 1;
    const m = n.edge || { style: 'bezier', color: null, width: 1 };
    const stroke = m.color || parent.edge?.color || '#606060';
    const d = (m.style || 'bezier').includes('bezier')
      ? (() => { const sx = parent._parent ? sign : 0; return `M ${s.x} ${s.y} C ${s.x + sx * EDGE_XCTRL} ${s.y} ${e.x - sign * EDGE_CHILD_XCTRL} ${e.y} ${e.x} ${e.y}`; })()
      : `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
    out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${m.width || 1}"/>`);
  });

  walk(root, (n) => {
    if (n.folded) return;
    for (const al of n.arrowlinks) {
      const target = index.get(al.destination);
      if (!target) continue;
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
    const x = n._contentX, y = n._contentY, w = n._w, h = n._h;
    const style = n === root ? 'root' : resolvedStyle(n, root);
    const sel = opts.selectedNode === n;
    if (style === 'root') {
      out.push(`<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${n.bg || (sel ? '#cfe3ff' : '#eef2f7')}" stroke="#808080"/>`);
    } else if (style === 'bubble') {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ry="10" fill="${n.bg || (sel ? '#cfe3ff' : '#ffffff')}" stroke="${n.color || '#404040'}"/>`);
    } else {
      out.push(`<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${n.color || '#404040'}"/>`);
    }
    const fw = n.font?.bold ? ' font-weight="bold"' : '';
    const fs = n.font?.italic ? ' font-style="italic"' : '';
    out.push(`<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" fill="${n.color || '#101010'}"${fw}${fs}>${escXml(n.text)}</text>`);
  });

  out.push('</svg>');
  return out.join('\n');
}
