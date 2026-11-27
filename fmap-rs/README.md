# fmap-rs: Freeplane CLI & Graph Engine (Rust + LadybugDB)

Reimplementasi utilitas CLI `fmap` dari Node.js ke **Rust murni (Native)** dengan mesin database graf **LadybugDB (`lbug`)**.

## 🚀 Keunggulan Versi Rust

1. **Ukuran Binary Sangat Ramping**:
   - Versi Node.js SEA sebelumnya: **~150 MB**
   - Versi Rust Release: **~25 MB** (turun >80%, termasuk font canvas grafis)
2. **Startup Time Instan**: Eksekusi sub-milidetik (<10ms) tanpa overhead inisialisasi V8 / runtime Node.js.
3. **Database Graf Native**: Murni menggunakan **LadybugDB** dengan Cypher query engine untuk traversal pohon, pathfinding, dan manipulasi node.
4. **Full Parity dengan Format FreeMind / Freeplane**:
   - Mendukung format standar `.mm` (FreeMind XML) untuk ekspor, impor, dan migrasi data.
   - Outliner Tree View dengan box-drawing Unicode.
   - Mindmap 2D Canvas Terminal (gaya DOS) dan **canvas grafis high-resolution**.
   - Interactive Terminal UI (TUI) berbasis `ratatui` + `crossterm`, dengan
     dukungan gambar **sixel / kitty / iTerm2** lewat `ratatui-image`.

---

## 📂 Struktur Proyek

```text
fmap-rs/
├── Cargo.toml
├── README.md
├── assets/
│   ├── DejaVuSansMono.ttf   # Font monospace yang di-embed untuk canvas grafis
│   └── DejaVu-LICENSE.txt
└── src/
    ├── main.rs              # Main entry point & CLI command dispatcher
    ├── cli/
    │   └── mod.rs           # Definisi argumen & subcommands (Clap v4)
    ├── model.rs             # Model data (MindMap, MapNode, TreeNode)
    ├── parser/
    │   ├── mod.rs
    │   └── freemind.rs      # Parser & Serializer XML FreeMind (.mm)
    ├── formatter/
    │   ├── mod.rs
    │   ├── tree_view.rs     # Visualisasi Outliner Tree terminal
    │   ├── map_canvas.rs    # Layout + visualisasi 2D DOS-style (ASCII)
    │   └── map_image.rs     # Renderer RGBA high-resolution untuk canvas grafis
    ├── storage/
    │   ├── mod.rs
    │   └── ladybug.rs       # Adapter LadybugDB & Cypher graph queries
    └── tui/
        ├── mod.rs
        └── interactive.rs   # Interactive TUI (Ratatui multi-panel + scroll)
```

---

## ⚡ Panduan Menjalankan

### 1. Kompilasi
```bash
cargo build --release
```
Binary executable akan berada di `./target/release/fmap`.

### 2. Perintah CLI Utama

```bash
# Bantuan
./target/release/fmap --help

# Daftar mindmap tersimpan
./target/release/fmap map list

# Buat mindmap baru
./target/release/fmap map create "Rencana Sistem" --root "Arsitektur Inti"

# Tambah cabang baru
./target/release/fmap node add <map_id> <parent_id> "Nama Cabang"

# Geser urutan node di antara saudaranya
./target/release/fmap node up <map_id> <node_id>
./target/release/fmap node down <map_id> <node_id>

# Tampilkan struktur pohon outliner
./target/release/fmap view <map_id>

# Tampilkan kanvas 2D DOS terminal
./target/release/fmap canvas <map_id>

# Simpan canvas sebagai PNG high-resolution
./target/release/fmap canvas <map_id> --image peta.png

# Buka TUI Interaktif (tekan v untuk beralih Canvas/Tree, q untuk keluar)
./target/release/fmap ui <map_id>

# Buka langsung di canvas grafis sixel (paksa protokol bila auto-deteksi salah)
./target/release/fmap ui <map_id> --canvas --graphics sixel
./target/release/fmap ui <map_id> --canvas --graphics kitty --cell-size 8x16

# Ekspor ke FreeMind XML (.mm)
./target/release/fmap map export <map_id> -o peta.mm

# Impor dari file .mm
./target/release/fmap map import peta.mm -t "Peta Impor"

# Pencarian teks node
./target/release/fmap search "kata_kunci"

# Buat arrow link terarah dari satu node ke node lain
./target/release/fmap link add <map_id> <source_node_id> <target_node_id>

# Hapus arrow link terarah
./target/release/fmap link rm <map_id> <source_node_id> <target_node_id>
```

Arrow link dari format FreeMind/Freeplane `.mm` ikut diimpor dan diekspor. Di mode
2D Canvas ASCII, arrow link digambar sebagai garis ortogonal bermata panah
(`▶`/`◀`) dan diwarnai magenta; di mode grafis, arrow link menjadi kurva halus
berwarna pink dengan arrowhead. Garis yang melewati kotak node akan
"tersembunyi" di belakang label agar teks tetap utuh. Di TUI, panel info juga
menampilkan arrow link keluar dan masuk untuk node terpilih. Tekan `r` untuk
membuat link dari node terpilih (masukkan ID target), atau `x` untuk menghapus
link keluar ke ID target tersebut.

### Canvas Grafis (Sixel / Kitty / iTerm2)

Mode Canvas 2D punya dua renderer:

- **Grafis high-resolution** — node digambar sebagai kartu rounded dengan border
  berwarna per level, konektor pohon berupa kurva bezier, arrow link berwarna
  pink, selection glow, dan teks anti-aliased memakai font DejaVu Sans Mono yang
  di-embed (tidak butuh font sistem). Ditampilkan lewat `ratatui-image` dengan
  protokol **sixel**, **kitty**, atau **iTerm2**.
- **ASCII** — renderer karakter lama, selalu tersedia sebagai fallback.

Deteksi protokol dilakukan dari environment (`TERM`, `TERM_PROGRAM`,
`KITTY_WINDOW_ID`, `LC_TERMINAL`) tanpa melakukan query stdin, sehingga tidak ada
risiko keypress pertama "tertelan". Jika auto-deteksi keliru, paksa dengan
`--graphics`:

```bash
fmap ui <map_id> --canvas --graphics sixel
fmap ui <map_id> --canvas --graphics kitty
fmap ui <map_id> --canvas --graphics iterm2
fmap ui <map_id> --canvas --graphics halfblocks   # fallback blok setengah
fmap ui <map_id> --canvas --graphics ascii        # mulai dari ASCII
```

Ukuran sel font yang dipakai renderer bisa diatur lewat `--cell-size WxH`
(default `9x18`). Di dalam TUI, tekan `g` untuk beralih antara renderer grafis
dan ASCII kapan saja; judul panel menunjukkan protokol yang aktif. `--graphics
auto` (default) akan memilih grafis bila terminal terdeteksi mendukung, dan
jatuh ke ASCII bila tidak.

Catatan terminal:

- **tmux** hanya meneruskan sixel/kitty jika passthrough diaktifkan; jika tidak,
  gunakan `--graphics halfblocks` atau biarkan ASCII.
- Terminal yang mendukung sixel tetapi tidak mengiklankannya di `TERM`
  (mis. sebagian `xterm`) perlu `--graphics sixel`.
- `fmap canvas <map_id> --image peta.png` memakai renderer grafis yang sama untuk
  menghasilkan PNG high-resolution, berguna untuk verifikasi atau dokumentasi.

### Editor di TUI

TUI juga bisa dipakai untuk mengubah isi peta tanpa keluar ke CLI:

| Key | Fungsi |
| --- | --- |
| `v` | Beralih Tree View ↔ 2D Canvas |
| `g` | Beralih renderer canvas: grafis ↔ ASCII |
| `←` / `↑` / `↓` / `→` | Sorot node tetangga |
| `Space` | Lipat / buka subtree node terpilih |
| `0` | Reset posisi pan canvas |
| `PgUp` / `PgDn` | Scroll panel detail node |
| `c` | Tambah child di bawah node terpilih |
| `s` | Tambah sibling (saudara) dari node terpilih |
| `Shift+↑` / `Shift+↓` | Geser node naik / turun di antara saudaranya |
| `e` | Edit teks node terpilih (prefill teks lama) |
| `n` | Edit catatan node terpilih |
| `Del` / `Shift+D` | Hapus node beserta seluruh subtree-nya (dengan konfirmasi) |
| `r` / `x` | Tambah / hapus arrow link |

Navigasi memakai tombol panah (`←↑↓→`); WASD dan hjkl tidak lagi dipakai agar `s`
bisa digunakan untuk sibling. Urutan sibling selalu ditampilkan dari yang paling
lama di atas ke yang paling baru di bawah, baik di Tree View maupun 2D Canvas;
urutan ini bisa diubah manual lewat `Shift+↑`/`Shift+↓` atau perintah CLI
`node up`/`node down`. Dialog input mendukung `←/→`, `Home/End`,
`Backspace`, dan `Delete` untuk mengedit teks. `Enter` menyimpan, `Esc`
membatalkan. Root node tidak bisa dihapus dan tidak punya sibling. Setelah setiap
perubahan, peta dimuat ulang otomatis dan pesan status singkat muncul di bar
bantuan. Catatan yang berisi beberapa baris akan ditampilkan sebagai satu baris
saat diedit dan disimpan kembali sebagai satu baris.

