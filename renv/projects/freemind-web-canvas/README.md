# FreeMind Web Canvas — prototipe inti

Reimplementasi inti FreeMind (Java/Swing) menjadi aplikasi web statis (HTML Canvas 2D),
dari riset source FreeMind commit `a3674b0`. Tanpa backend.

## Isi
- `src/freemind-core.mjs` — model node, parser/emitter `.mm` (raw richcontent), layout, renderer Canvas 2D + **renderer SVG headless** (`renderSVG`), hit-test.
- `src/index.html` — demo interaktif bergaya FreeMind: **bilah menu** (File/Edit/View/Insert/Format/Navigate/Help) + **toolbar ikon**, pan/zoom/select/edit/add/delete/fold/undo-redo, impor/ekspor `.mm`, **node motion** (oland tepi = Hgap/Vshift, Ctrl = jarak saudara, dobel-klik reset), **drag-drop** dengan ghost (drop: tengah = anak / tepi-dalam menghadap root = sisip sebelum sibling), **multi-select** (Shift+klik, Shift+seret latar = kotak seleksi), **clipboard** (Ctrl+C/X/V/D), **pencarian** (Ctrl+F, F3 / Shift+F3), **hyperlink** (Ctrl+klik buka), **ikon node** + penanda catatan/link (ikon di sisi **menghadap root**, sesuai `NodeView.updateIconPosition`), klik lingkaran tepi = fold, tombol Fold all / Unfold all, gaya edge & font lengkap; **panel inspektur** kanan: catatan, pemilih ikon, warna node/latar, gaya node, edge (gaya/lebar/warna), font (ukuran/keluarga/bold/italic/underline), **atribut** (tambah/edit/hapus) dengan mode tampil (semua/terpilih/sembunyi) dan render inline di bawah node; tombol zoom ±/100%; input Pointer Events + pan sentuh & pinch-zoom, `touch-action:none`.
- `src/icons/` + `src/icons-builtin.mjs` — 79 ikon BUILTIN FreeMind (disalin dari `freemind/images/` + `images/icons/`; urutan ikon & ikon link mengikuti `NodeView.updateIcons`).
- `src/ui/` — ikon toolbar FreeMind (file/new/open/save, edit cut/copy/paste, undo/redo, bold/italic/underline, cloud, fold, zoom, find) untuk bilah toolbar bergaya Swing.
- `src/sample.mm` — contoh peta.
- `test/roundtrip.mjs` — uji round-trip parser/emitter + sanity layout atas contoh dan 25 file `.mm` asli FreeMind.
- `test/render_svg.mjs` — render contoh ke `mindmap.svg` (artefak headless).

## Status uji
Tersapu 25 file `.mm` asli FreeMind (4965 node, 109 arrowlink, 40 cloud): semua terparse, round-trip struktur identik (`files_shape_ok=25`), layout finite (`files_layout_finite=25`), 0 gagal. Renderer SVG menghasilkan `mindmap.svg` yang valid XML. Mencakup cloud, arrowlink, richcontent HTML mentah, edge `WIDTH="thin"`.

## Jalankan
```bash
node test/roundtrip.mjs                 # uji
node test/render_svg.mjs /tmp/out.svg   # artefak SVG
python3 -m http.server 8000             # lalu buka src/index.html
```

## Pemetaan ke source FreeMind
| Aspek web | Source |
|---|---|
| `createNode`/field | `NodeAdapter.java` |
| `parseMM`/`serializeMM` | `XMLElementAdapter.java`, `NodeAdapter.save` |
| `layout` | `NodeViewLayoutAdapter.java`, `Left/RightNodeViewLayout`, `VerticalRootNodeViewLayout` |
| `render` bentuk/edge | `Fork/Bubble/RootMainView`, `Linear/Bezier/SharpLinear/SharpBezierEdgeView` |
| node motion (Hgap/Vshift) | `NodeMotionListenerView`, `MindMapNodeMotionListener` |
| ikon & fold indicator | `NodeView.updateIcons`, `MultipleImage`, `NodeFoldingComponent` |
| clipboard | `ClipboardController`, `PasteAction.insertNodeInto` |
| bilah menu | `controller/MenuBar.java` |
| posisi ikon node | `NodeView.updateIconPosition` (`isLeft ? LEADING : TRAILING`) |

## Lisensi aset
`src/icons/*.png` dan `src/ui/*` berasal dari FreeMind (GPLv2) → distribusi turunan wajib patuh GPL.

Catatan riset lengkap tersimpan di knowledge base renv (project `freemind-web-canvas`).

## Deploy (kandidat)
Firebase Hosting, project `freemind-web-canvas` (public dir `src/`):
- Live: https://freemind-web-canvas.web.app
- Console: https://console.firebase.google.com/project/freemind-web-canvas/overview
```bash
firebase deploy --only hosting --project freemind-web-canvas
```

## Batasan (di luar parity inti)
Plugin FreeMind, richcontent WYSIWYG penuh, cloud/arrowlink, enkripsi, undo/redo, kolaborasi.
