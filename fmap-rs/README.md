# fmap-rs: Freeplane CLI & Graph Engine (Rust + LadybugDB)

Reimplementasi utilitas CLI `fmap` dari Node.js ke **Rust murni (Native)** dengan mesin database graf **LadybugDB (`lbug`)**.

## 🚀 Keunggulan Versi Rust

1. **Ukuran Binary Sangat Ramping**:
   - Versi Node.js SEA sebelumnya: **~150 MB**
   - Versi Rust Release: **~15–20 MB** (turun >85%)
2. **Startup Time Instan**: Eksekusi sub-milidetik (<10ms) tanpa overhead inisialisasi V8 / runtime Node.js.
3. **Database Graf Native**: Murni menggunakan **LadybugDB** dengan Cypher query engine untuk traversal pohon, pathfinding, dan manipulasi node.
4. **Full Parity dengan Format FreeMind / Freeplane**:
   - Mendukung format standar `.mm` (FreeMind XML) untuk ekspor, impor, dan migrasi data.
   - Outliner Tree View dengan box-drawing Unicode.
   - Mindmap 2D Canvas Terminal (gaya DOS).
   - Interactive Terminal UI (TUI) berbasis `ratatui` + `crossterm`.

---

## 📂 Struktur Proyek

```text
fmap-rs/
├── Cargo.toml
├── README.md
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
    │   └── map_canvas.rs    # Visualisasi 2D DOS-style mindmap canvas
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

# Tampilkan struktur pohon outliner
./target/release/fmap view <map_id>

# Tampilkan kanvas 2D DOS terminal
./target/release/fmap canvas <map_id>

# Buka TUI Interaktif (tekan v untuk beralih Canvas/Tree, q untuk keluar)
./target/release/fmap ui <map_id>

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
2D Canvas, arrow link digambar sebagai garis ortogonal bermata panah (`▶`/`◀`) dan
diwarnai magenta; garis yang melewati kotak node akan "tersembunyi" di belakang
label agar teks tetap utuh. Di TUI, panel info juga menampilkan arrow link keluar
dan masuk untuk node terpilih. Tekan `r` untuk membuat link dari node terpilih
(masukkan ID target), atau `x` untuk menghapus link keluar ke ID target tersebut.

### Editor di TUI

TUI juga bisa dipakai untuk mengubah isi peta tanpa keluar ke CLI:

| Key | Fungsi |
| --- | --- |
| `c` | Tambah child di bawah node terpilih |
| `s` | Tambah sibling (saudara) dari node terpilih |
| `e` | Edit teks node terpilih (prefill teks lama) |
| `n` | Edit catatan node terpilih |
| `Del` / `Shift+D` | Hapus node beserta seluruh subtree-nya (dengan konfirmasi) |
| `r` / `x` | Tambah / hapus arrow link |

Navigasi memakai tombol panah (`←↑↓→`); WASD dan hjkl tidak lagi dipakai agar `s`
bisa digunakan untuk sibling. Dialog input mendukung `←/→`, `Home/End`,
`Backspace`, dan `Delete` untuk mengedit teks. `Enter` menyimpan, `Esc`
membatalkan. Root node tidak bisa dihapus dan tidak punya sibling. Setelah setiap
perubahan, peta dimuat ulang otomatis dan pesan status singkat muncul di bar
bantuan. Catatan yang berisi beberapa baris akan ditampilkan sebagai satu baris
saat diedit dan disimpan kembali sebagai satu baris.

