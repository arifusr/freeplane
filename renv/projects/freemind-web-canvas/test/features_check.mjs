import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNode, layout, serializeMM, parseMM, renderSVG,
  iconKeys, iconRowWidth, fontString, cloneSubtree, foldAll, visibleNodes,
  ICON_SIZE,
} from '../src/freemind-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.RENV_RUN_DIR ? path.resolve(process.env.RENV_RUN_DIR) : here;
const m = {};

// 1) urutan ikon: stateIcon(catatan) -> ikon builtin -> ikon link (NodeView.updateIcons)
const n = createNode('x');
n.icons = ['idea', 'flag'];
n.note = 'catatan';
n.link = 'mailto:a@b.c';
m.icons_order_ok = JSON.stringify(iconKeys(n)) === JSON.stringify(['knotes', 'idea', 'flag', 'Mail']) ? 1 : 0;
n.link = 'https://example.org/page';
m.link_icon_url_ok = iconKeys(n).at(-1) === 'Link' ? 1 : 0;
n.link = '#target';
m.link_icon_local_ok = iconKeys(n).at(-1) === 'LinkLocal' ? 1 : 0;
n.link = 'run.com';
m.link_icon_exec_ok = iconKeys(n).at(-1) === 'Executable' ? 1 : 0;

// 2) lebar baris ikon = jumlah ikon * ICON_SIZE
m.icon_row_width_ok = iconRowWidth({ icons: ['a', 'b', 'c'], note: null, link: null }) === 3 * ICON_SIZE ? 1 : 0;

// 3) fontString menghormati size/bold/italic/underline/name
const f = { size: 22, bold: true, italic: true, underline: true, name: 'serif' };
m.font_string_ok = /22px/.test(fontString({ font: f })) && /italic/.test(fontString({ font: f })) &&
  /bold/.test(fontString({ font: f })) && /serif/.test(fontString({ font: f })) ? 1 : 0;

// 4) empat gaya edge tidak melempar & menghasilkan geometri berbeda
const styles = ['linear', 'bezier', 'sharp_linear', 'sharp_bezier'];
const svgs = new Set();
let edgeOk = 1;
for (const st of styles) {
  const r = createNode('root');
  const c = createNode('c');
  c.edge = { style: st, color: '#c00', width: 2 };
  r.children = [c];
  layout(r);
  try { svgs.add(renderSVG(r)); } catch { edgeOk = 0; }
}
m.edge_styles_ok = edgeOk;
m.edge_styles_distinct = svgs.size === styles.length ? 1 : 0;

// 5) cloneSubtree = salinan dalam yang independen
const orig = createNode('a');
orig.icons = ['idea'];
orig.children = [createNode('b')];
const clone = cloneSubtree(orig);
clone.text = 'a2';
clone.icons.push('flag');
clone.children[0].text = 'b2';
m.clone_subtree_ok = orig.text === 'a' && orig.icons.length === 1 && orig.children[0].text === 'b' ? 1 : 0;

// 6) foldAll menutup/membuka semua node beranak
const r2 = createNode('r');
r2.children = [createNode('p')];
r2.children[0].children = [createNode('g')];
foldAll(r2, true);
const allFolded = r2.folded === true && r2.children[0].folded === true;
foldAll(r2, false);
m.fold_all_ok = allFolded && r2.folded === false && r2.children[0].folded === false ? 1 : 0;

// 7) ekstra: emisi .mm tetap round-trip setelah fitur
const sm = parseMM(serializeMM(orig));
m.roundtrip_after_features_ok = parseMM(serializeMM(sm)).children.length === sm.children.length ? 1 : 0;

// 8) fold menyembunyikan seluruh subtree + sibling reflow (perilaku FreeMind)
const fr = createNode('r');
const fa = createNode('A');
fa.children = [createNode('a1'), createNode('a2')];
const fb = createNode('B');
fr.children = [fa, fb];
layout(fr);
const vis0 = visibleNodes(fr).length;
const by0 = fb._contentY;
fa.folded = true;
layout(fr);
const vis1 = visibleNodes(fr).length;
m.fold_hides_subtree_ok = vis0 === 5 && vis1 === 3 ? 1 : 0;
m.fold_reflow_ok = fb._contentY !== by0 ? 1 : 0;
m.fold_svg_hides_text_ok = renderSVG(fr).includes('a1') ? 0 : 1;
fa.folded = false;
layout(fr);
m.unfold_restores_ok = visibleNodes(fr).length === 5 ? 1 : 0;

// 9) arrowlink ke target yang tersembunyi tidak digambar
const ar = createNode('root');
const asrc = createNode('src');
const bdst = createNode('dst');
const b1 = createNode('b1'); b1.id = 'h1'; bdst.children = [b1];
asrc.arrowlinks = [{ destination: 'h1', color: '#0000ff', startArrow: 'None', endArrow: 'Default' }];
ar.children = [asrc, bdst];
layout(ar);
const arrowShown = renderSVG(ar).includes('#0000ff');
bdst.folded = true;
layout(ar);
const arrowHidden = !renderSVG(ar).includes('#0000ff');
m.arrowlink_hidden_target_ok = arrowShown && arrowHidden ? 1 : 0;

m.ok = Object.values(m).every((v) => v === 1) ? 1 : 0;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(m, null, 1));
console.log(JSON.stringify(m));
