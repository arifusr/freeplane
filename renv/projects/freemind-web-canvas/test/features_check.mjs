import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNode, layout, serializeMM, parseMM, renderSVG,
  iconKeys, iconRowWidth, fontString, cloneSubtree, foldAll, visibleNodes, attrVisible,
  resolvedStyle, ICON_SIZE, summaryGroup, summaryBracket, SUMMARY_HGAP, arrowCurve, arrowMidpoint, hitArrow, findNeighbor,
  textLines, freshId, ensureNodeId, inheritVisualAttributes,
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

// 2b) sisi ikon = sisi MENGHADAP root (NodeView.updateIconPosition:
//     kanan -> LEADING? tidak: isLeft?LEADING:TRAILING, jadi kanan = ikon kiri teks).
const ir = createNode('R');
const irR = createNode('Kanan'); irR.icons = ['help']; irR.position = 'right';
const irL = createNode('Kiri'); irL.icons = ['help']; irL.position = 'left';
ir.children = [irR, irL];
layout(ir);
const isvg = renderSVG(ir, { images: { help: { width: 16, height: 16 } } });
const imgXs = [...isvg.matchAll(/<image[^>]*x="(-?[\d.]+)"/g)].map((x) => parseFloat(x[1]));
const txtRt = parseFloat((isvg.match(/<text x="(-?[\d.]+)"[^>]*>Kanan</) || [])[1]);
const txtLt = parseFloat((isvg.match(/<text x="(-?[\d.]+)"[^>]*>Kiri</) || [])[1]);
m.icon_side_ok = (irR._side === 'right' && imgXs.some((x) => x < txtRt)) &&
  (irL._side === 'left' && imgXs.some((x) => x > txtLt)) ? 1 : 0;

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

// 10) atribut & catatan: visibilitas mode + render blok di SVG
const an = createNode('a'); an.attrs = [{ name: 'warna', value: 'merah' }];
m.attr_visible_all_ok = attrVisible(an, 'all', null, null) ? 1 : 0;
m.attr_visible_hide_ok = attrVisible(an, 'hide', null, null) ? 0 : 1;
m.attr_visible_selected_ok = (attrVisible(an, 'selected', an, null) && !attrVisible(an, 'selected', null, null)) ? 1 : 0;
const ar2 = createNode('root'); const ac = createNode('c'); ac.attrs = [{ name: 'k', value: 'v' }];
ac._baseH = 22; ac._attrRows = 1; ac._attrsVisible = ac.attrs; ac._attrColW = 40;
ar2.children = [ac]; layout(ar2);
m.attr_svg_block_ok = renderSVG(ar2).includes('>v<') ? 1 : 0;
m.note_roundtrip_ok = parseMM(serializeMM(function () { const z = createNode('n'); z.note = 'catatan'; return z; }())).note === 'catatan' ? 1 : 0;

// 11) gaya node: default 'as_parent' (freemind.properties) → node baru mengikuti gaya
//     node asalnya; root selalu digambar sebagai bubble (RootMainView).
const sr = createNode('root');
const sc = createNode('anak'); sc.style = 'bubble';
const sg = createNode('cucu');
const sf = createNode('keponakan');
sc.children = [sg];
sr.children = [sc, sf];
layout(sr);
m.style_root_visual_ok = resolvedStyle(sr, sr) === 'bubble' ? 1 : 0;         // root = RootMainView
m.style_default_fork_ok = resolvedStyle(sf, sr) === 'fork' ? 1 : 0;          // anak root default = fork
m.style_inherit_child_ok = resolvedStyle(sg, sr) === 'bubble' ? 1 : 0;       // cucu ikut induk (bubble)
sc.style = 'fork'; layout(sr);
m.style_follow_parent_change_ok = resolvedStyle(sg, sr) === 'fork' ? 1 : 0;  // ikut saat induk berubah
const sroot = createNode('root2'); const smid = createNode('mid'); smid.style = 'bubble';
const sleaf = createNode('leaf'); smid.children = [sleaf]; sroot.children = [smid]; layout(sroot);
m.style_explicit_parent_ok = resolvedStyle(sleaf, sroot) === 'bubble' ? 1 : 0;

// 12) teks multi-baris: newline disimpan sebagai &#10; dan dirender per baris.
const ml = createNode('baris satu\nbaris dua');
const mlOut = serializeMM(ml);
m.multiline_entity_ok = mlOut.includes('&#10;') ? 1 : 0;
m.multiline_roundtrip_ok = parseMM(mlOut).text === 'baris satu\nbaris dua' ? 1 : 0;
const mroot = createNode('r');
const mnode = createNode('dua\nbaris'); mroot.children = [mnode]; layout(mroot);
m.multiline_svg_ok = (renderSVG(mroot).match(/<text /g) || []).length >= 3 ? 1 : 0;
m.multiline_height_ok = (mnode._baseH || mnode._h) > (mroot._baseH || mroot._h) ? 1 : 0;

// 13) summary node: hook SummaryNode/FirstGroupNode, grup, bracket, dan SVG.
const sumRoot = createNode('root');
const sumKids = ['A', 'B', 'C', 'D'].map((t) => createNode(t));
sumKids[0].firstGroup = true;
const sum = createNode('ringkasan');
sum.summary = true;
sum.hGap = SUMMARY_HGAP;
sum.edge = { style: 'bezier', color: '#ff0000', width: 2 };
sumRoot.children = [...sumKids, sum];
layout(sumRoot);
const sumXml = serializeMM(sumRoot);
m.summary_hook_ok = sumXml.includes('NAME="SummaryNode"') && sumXml.includes('NAME="FirstGroupNode"') ? 1 : 0;
const sumBack = parseMM(sumXml);
layout(sumBack);
m.summary_roundtrip_ok = sumBack.children[4].summary === true && sumBack.children[0].firstGroup === true ? 1 : 0;
m.summary_group_ok = summaryGroup(sumBack.children[4]).map((x) => x.text).join('') === 'ABCD' ? 1 : 0;
const bkt = summaryBracket(sumBack.children[4]);
m.summary_bracket_ok = (bkt && bkt.top < bkt.bottom && bkt.group.length === 4) ? 1 : 0;
const sumSvg = renderSVG(sumBack);
m.summary_svg_ok = (sumSvg.match(/stroke="#ff0000"/g) || []).length === 2 ? 1 : 0;
const sumNode = sumBack.children[4];
const sumG = summaryGroup(sumNode);
const groupOuter = Math.max(...sumG.map((x) => x._contentX + x._w));
const groupMid = (Math.min(...sumG.map((x) => x._contentY)) + Math.max(...sumG.map((x) => x._contentY + (x._baseH || x._h)))) / 2;
m.summary_front_ok = sumNode._contentX > groupOuter ? 1 : 0;
m.summary_center_ok = Math.abs((sumNode._contentY + sumNode._h / 2) - groupMid) <= 1 ? 1 : 0;
const sumX0 = sumNode._contentX, sumY0 = sumNode._contentY;
sumNode.hGap += 20;
sumNode.shiftY = 12;
layout(sumBack);
m.summary_move_ok = Math.abs(sumNode._contentX - sumX0 - 20) <= 1 && Math.abs(sumNode._contentY - sumY0 - 12) <= 1 ? 1 : 0;

// 14) banyak panah (ArrowLink) dari satu sumber ke beberapa konteks.
const arRoot = createNode('root');
const arSrc = createNode('sumber');
const arB = createNode('tujuan B'); arB.id = 'b1';
const arC = createNode('tujuan C'); arC.id = 'c1';
arSrc.arrowlinks = [
  { destination: 'b1', color: '#123456', startArrow: 'None', endArrow: 'Default', startInclination: null, endInclination: null },
  { destination: 'c1', color: '#654321', startArrow: 'Default', endArrow: 'Default', startInclination: null, endInclination: null, sourceLabel: 'awal', middleLabel: 'tengah', targetLabel: 'akhir' },
];
arRoot.children = [arSrc, arB, arC];
layout(arRoot);
const arSvg = renderSVG(arRoot);
m.arrow_multi_ok = (arSvg.match(/stroke="#123456"/g) || []).length === 1
  && (arSvg.match(/stroke="#654321"/g) || []).length === 1 ? 1 : 0;
const arBack = parseMM(serializeMM(arRoot));
m.arrow_multi_roundtrip_ok = arBack.children[0].arrowlinks.length === 2
  && arBack.children[0].arrowlinks[1].destination === 'c1' ? 1 : 0;
m.arrow_labels_roundtrip_ok = arBack.children[0].arrowlinks[1].sourceLabel === 'awal'
  && arBack.children[0].arrowlinks[1].middleLabel === 'tengah'
  && arBack.children[0].arrowlinks[1].targetLabel === 'akhir' ? 1 : 0;
m.arrow_label_svg_ok = arSvg.includes('>awal<') && arSvg.includes('>tengah<') && arSvg.includes('>akhir<') ? 1 : 0;

// 15) panah bisa dipilih (hit-test kurva) dan ditekuk (inclination).
const hRoot = createNode('root');
const hSrc = createNode('S'); hSrc.id = 'hs';
const hDst = createNode('T'); hDst.id = 'ht';
hSrc.arrowlinks = [{ destination: 'ht', color: '#0000ff', startArrow: 'None', endArrow: 'Default' }];
hRoot.children = [hSrc, hDst];
layout(hRoot);
const hg = arrowCurve(hSrc, hDst, hSrc.arrowlinks[0]);
const t = 0.5, u = 1 - t;
const mx = u * u * u * hg.s.x + 3 * u * u * t * hg.p3.x + 3 * u * t * t * hg.p4.x + t * t * t * hg.e.x;
const my = u * u * u * hg.s.y + 3 * u * u * t * hg.p3.y + 3 * u * t * t * hg.p4.y + t * t * t * hg.e.y;
const hHit = hitArrow(hRoot, mx, my, 2);
const hMiss = hitArrow(hRoot, mx, my + 50, 2);
m.arrow_hit_ok = hHit && hHit.node === hSrc && hHit.link === hSrc.arrowlinks[0] && !hMiss ? 1 : 0;
const hm = arrowMidpoint(hSrc, hDst, hSrc.arrowlinks[0]);
m.arrow_midpoint_ok = Math.abs(hm.x - mx) < 1e-6 && Math.abs(hm.y - my) < 1e-6 ? 1 : 0;
hSrc.arrowlinks[0].startInclination = { x: hg.reach, y: 50 };
hSrc.arrowlinks[0].endInclination = { x: hg.reach, y: 50 };
const hg2 = arrowCurve(hSrc, hDst, hSrc.arrowlinks[0]);
const bend3 = (hg2.p3.x - hg.p3.x) * hg.nx + (hg2.p3.y - hg.p3.y) * hg.ny;
const bend4 = (hg2.p4.x - hg.p4.x) * hg.nx + (hg2.p4.y - hg.p4.y) * hg.ny;
m.arrow_bend_ok = bend3 > 0 && bend4 > 0 ? 1 : 0;
m.arrow_default_reach_ok = hg.reach === Math.max(40, Math.hypot(hg.e.x - hg.s.x, hg.e.y - hg.s.y)) ? 1 : 0;
const dotStart = (hg.p3.x - hg.s.x) * hg.ux + (hg.p3.y - hg.s.y) * hg.uy;
const dotEnd = (hg.e.x - hg.p4.x) * hg.ux + (hg.e.y - hg.p4.y) * hg.uy;
m.arrow_control_relative_ok = dotStart > 0 && dotEnd > 0 ? 1 : 0;
// Ekor node kiri menuju node kanan harus mengarah ke tujuan, bukan ke sisi map.
const crossRoot = createNode('root');
const crossL = createNode('kiri'); crossL.position = 'left';
const crossR = createNode('kanan'); crossR.position = 'right';
crossRoot.children = [crossL, crossR]; layout(crossRoot);
const crossG = arrowCurve(crossL, crossR, { startArrow: 'None', endArrow: 'Default' });
m.arrow_tail_relative_ok = crossG.ux > 0 && crossG.p3.x > crossG.s.x && crossG.p4.x < crossG.e.x ? 1 : 0;
// Inclination juga memindahkan titik taut (ekor) ke edge lain, seperti Freeplane.
const edgeS = createNode('S'); edgeS._contentX = 0; edgeS._contentY = 0; edgeS._w = 100; edgeS._h = 40;
const edgeT = createNode('T'); edgeT._contentX = 300; edgeT._contentY = 0; edgeT._w = 100; edgeT._h = 40;
const edgeDefault = arrowCurve(edgeS, edgeT, {});
const edgeMoved = arrowCurve(edgeS, edgeT, { startInclination: { x: 0, y: 100 }, endInclination: null });
m.arrow_tail_edge_ok = Math.abs(edgeDefault.s.x - 100) < 1e-9 && Math.abs(edgeDefault.s.y - 20) < 1e-9
  && Math.abs(edgeMoved.s.x - 50) < 1e-9 && Math.abs(edgeMoved.s.y - 40) < 1e-9 ? 1 : 0;
const idUsed = new Set(['ID_existing']);
const idNode = createNode('tetap'); idNode.id = 'ID_existing';
m.arrow_id_preserved_ok = ensureNodeId(idNode, idUsed) === 'ID_existing' && idNode.id === 'ID_existing' ? 1 : 0;
const idNew = createNode('baru');
const idValue = ensureNodeId(idNew, idUsed);
m.arrow_id_generated_ok = idNew.id === idValue && idValue.startsWith('ID_') && idUsed.has(idValue) ? 1 : 0;

// 16) navigasi keyboard spasial: panah memilih node terdekat pada arah itu.
const navRoot = createNode('root');
const navL = createNode('L'), navR = createNode('R');
const navT = createNode('T'), navB = createNode('B');
navRoot.children = [navL, navR, navT, navB];
navRoot._contentX = 0; navRoot._contentY = 0; navRoot._w = 100; navRoot._h = 40;
navL._contentX = -200; navL._contentY = 0; navL._w = 80; navL._h = 30;
navR._contentX = 200; navR._contentY = 0; navR._w = 80; navR._h = 30;
navT._contentX = 0; navT._contentY = -150; navT._w = 80; navT._h = 30;
navB._contentX = 0; navB._contentY = 150; navB._w = 80; navB._h = 30;
m.arrow_nav_ok = findNeighbor(navRoot, navRoot, 1, 0) === navR
  && findNeighbor(navRoot, navRoot, -1, 0) === navL
  && findNeighbor(navRoot, navRoot, 0, -1) === navT
  && findNeighbor(navRoot, navRoot, 0, 1) === navB ? 1 : 0;

// 17) perataan teks node (TEXT_ALIGN) tersimpan dan dipakai render SVG.
const taRightRoot = createNode('rata kanan');
taRightRoot.textAlign = 'RIGHT';
layout(taRightRoot);
const taRightBack = parseMM(serializeMM(taRightRoot));
layout(taRightBack);
const taRightSvg = renderSVG(taRightBack);
const taLeftRoot = createNode('rata kiri');
taLeftRoot.textAlign = 'LEFT';
layout(taLeftRoot);
const taLeftSvg = renderSVG(taLeftRoot);
m.text_align_ok = taRightBack.textAlign === 'RIGHT' && taRightSvg.includes('text-anchor="end"')
  && taLeftSvg.includes('text-anchor="start"') ? 1 : 0;

// 18) indentasi: tab pada teks node dirender sebagai 4 spasi di setiap baris.
const tabRoot = createNode('\tindent\n\tdua');
layout(tabRoot);
m.tab_indent_ok = JSON.stringify(textLines(tabRoot)) === JSON.stringify(['    indent', '    dua']) ? 1 : 0;

// 19) node baru mewarisi font (termasuk ukuran), warna, latar, dan edge dari node aktif.
const inhSrc = createNode('aktif');
inhSrc.style = 'bubble'; inhSrc.color = '#ff0000'; inhSrc.bg = '#eeeeee';
inhSrc.font = { name: 'Arial', size: 20, bold: true, italic: true, underline: true };
inhSrc.edge = { style: 'linear', color: '#00ff00', width: 3 };
const inhChild = inheritVisualAttributes(createNode('anak'), inhSrc);
const inhSibling = inheritVisualAttributes(createNode('saudara'), inhSrc);
const sameFormat = (a, b) => JSON.stringify([a.style, a.color, a.bg, a.font, a.edge])
  === JSON.stringify([b.style, b.color, b.bg, b.font, b.edge]);
m.inherit_child_format_ok = sameFormat(inhChild, inhSrc) ? 1 : 0;
m.inherit_sibling_format_ok = sameFormat(inhSibling, inhSrc) ? 1 : 0;
m.inherit_font_size_ok = inhChild.font.size === 20 ? 1 : 0;
m.inherit_no_shared_ref_ok = inhChild.font !== inhSrc.font && inhChild.edge !== inhSrc.edge ? 1 : 0;
m.inherit_null_ok = sameFormat(inheritVisualAttributes(createNode('x'), createNode('kosong')), createNode('kosong')) ? 1 : 0;

m.ok = Object.values(m).every((v) => v === 1) ? 1 : 0;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(m, null, 1));
console.log(JSON.stringify(m));
