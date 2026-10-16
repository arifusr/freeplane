# FreeMind Web Canvas — prototipe inti

Reimplementasi inti FreeMind (Java/Swing) menjadi aplikasi web statis (HTML Canvas 2D),
dari riset source FreeMind commit `a3674b0`. Tanpa backend.

## Isi
- `src/freemind-core.mjs` — model node, parser/emitter `.mm` (raw richcontent), layout, renderer Canvas 2D + **renderer SVG headless** (`renderSVG`), hit-test.
- `src/index.html` — demo interaktif (pan/zoom/select/edit/add/delete/fold/undo-redo, impor/ekspor `.mm`, drag node: jadi anak / sisip sebelum-sesudah sibling).
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
| `render` bentuk/edge | `Fork/Bubble/RootMainView`, `BezierEdgeView` |

Catatan riset lengkap tersimpan di knowledge base renv (project `freemind-web-canvas`).

## Batasan (di luar parity inti)
Plugin FreeMind, richcontent WYSIWYG penuh, cloud/arrowlink, enkripsi, undo/redo, kolaborasi.
