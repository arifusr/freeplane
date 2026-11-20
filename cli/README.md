# Freeplane CLI & Graph Engine (`fmap`)

CLI dan mesin basis data graf (berbasis **LadybugDB** dengan fallback **SQLite Graph**) untuk mind map Freeplane / FreeMind.

Dirancang untuk:
1. **Navigasi Cepat di Terminal**: Tampilan outliner pohon hierarkis (`fmap view`) dan antarmuka TUI layar penuh (`fmap ui`).
2. **Penyimpanan Graf Persisten**: Mendukung relasi pohon (`PARENT_OF`) dan relasi bebas (*arrowlink* `CONNECTS_TO`).
3. **Ramah Agent AI (GraphRAG)**: Kueri subgraf bertetangga (*k-hop neighborhood*), pencarian teks penuh (FTS5), dan pelacakan jalur penalaran (*shortest path reasoning*).
4. **Interoperabilitas Penuh**: Import/export round-trip format XML `.mm` dan render visual ke format SVG.

---

## 📌 Persyaratan Sistem

* **Node.js**: Versi `22.0.0` atau yang lebih baru (lingkungan ini menggunakan Node.js v26 dengan dukungan bawaan `node:sqlite`).
* **Zero External Dependencies**: Mesin graf internal berjalan langsung tanpa perlu `npm install` pihak ketiga.

---

## 📦 Pilihan Bentuk Executable

CLI ini tersedia dalam **2 bentuk**:

1. **Executable Script (Langsung Pakai)**:
   * File: `cli/bin/fmap.mjs`
   * Sudah berizin eksekusi (`chmod +x`). Dapat langsung dijalankan selama ada Node.js di sistem.
2. **Standalone Binary Executable (ELF 64-bit)**:
   * File: `cli/dist/fmap`
   * Dibangun dengan teknologi **Node.js Single Executable Application (SEA)**.
   * Merupakan binary mandiri yang dapat dipindahkan dan dijalankan langsung di mesin Linux x86_64 tanpa perlu Node.js terpasang terpisah.
   * Untuk mengompilasi ulang binary kapan saja:
     ```bash
     cd cli && npm run build:bin
     ```

---

## 🚀 Quickstart & Contoh Alur Penggunaan

### 1. Menjalankan CLI Langsung
Dari root repository ini:

```bash
# Menampilkan menu bantuan lengkap
./cli/bin/fmap.mjs --help
```

### 2. Membuat Alias Global (Direkomendasikan)
Agar bisa dipanggil dengan singkat `fmap` dari direktori mana saja:
```bash
alias fmap="/home/arifusr/freeplane/cli/bin/fmap.mjs"
```

### 3. Membuat Mind Map Baru
Anda bisa langsung membuat peta baru dari terminal:
```bash
# Membuat peta baru dengan judul
fmap map create "Rencana Riset 2027"

# Atau dengan teks akar (root) khusus:
fmap map create "Rencana Riset 2027" --root "Fokus Riset AI"
```
Output akan memberikan ID peta dan ID node akar (`root`), serta instruksi langkah berikutnya.

### 4. Mengimpor File Mind Map (`.mm`) yang Sudah Ada
```bash
fmap map import renv/projects/freemind-web-canvas/src/sample.mm -t "Proyek 2027"
```
Output:
```text
Mengimpor 'sample.mm' ke database graf...
✔ Peta berhasil diimpor! ID: map_mwndkbhy (12 nodes, 11 edges).
```

### 5. Melihat Daftar Peta
```bash
fmap map list
```

### 6. Menampilkan Pohon Outliner di Terminal
```bash
fmap view <map_id>
```
Contoh tampilan:
```text
[ID_root] 🧠 FreeMind Web Canvas
├── (R) [-] [n-renderer] Renderer
│   ├──     [ID_1] Canvas 2D
│   ├──     [ID_2] Bezier edge
│   └──     [ID_3] Zoom & pan
├── (L) [-] [n-model] Model
│   ├── [+] [ID_4] Node tree (1 sub-nodes folded)
│   └──     [ID_5] .mm parse/emit
└── (R) [-] [ID_6] Interaksi
    ├──     [ID_7] Enter = sibling
    └──     [ID_8] Tab = child
```

### 7. Menampilkan Mindmap 2D di Terminal

Tersedia **2 pilihan orientasi layout 2D**:

#### A. Mode Radial Vertikal (Root di Tengah, Cabang Atas & Bawah)
```bash
fmap canvas <map_id> --vertical
# atau versi ringkas:
fmap view2d <map_id>
```
Root berada di tengah kanvas terminal; cabang-cabang menyebar ke **atas** (`▲`) dan ke **bawah** (`▼`), lengkap dengan kotak rounded box-drawing dan panah relasi:

```text
                                            ╭───────────╮     ╭────────────────╮
                                            │ Node tree │     │ .mm parse/emit │
                                            ╰───────────╯     ╰────────────────╯
                                                  │                    │
                                                  ┴      ╭───────╮     ┴
                                                         │ Model │
                                                         ╰───┴───╯
                                                             ▲
                                                 ╭────────────────────────╮
                                                 │ 🧠 FreeMind Web Canvas │
                                                 ╰────────────│───────────╯
                              ┌───────────────────────────────┬────────────────────────────┐
                              │                                                            │
                        ╭──────────╮                                                 ╭───────────╮
                        │ Renderer │                                                 │ Interaksi │
                        ╰────┬─────╯                                                 ╰─────┬─────╯
                             │                                                             │
   ╭───────────╮      ╭─────────────╮      ╭────────────╮    ╭─────────────────╮     ╭──────────╮
   │ Canvas 2D │      │ Bezier edge │      │ Zoom & pan │    │ Enter = sibling │     │ Tab = ...│
   ╰───────────╯      ╰─────────────╯      ╰────────────╯    ╰─────────────────╯     ╰──────────╯
```

#### B. Mode DOS Canvas (Root di Kiri, Cabang Menyebar ke Kanan)
```bash
fmap canvas <map_id>
```
Root di kiri dan cabang tumbuh ke kanan. Anak selalu mengisi atas & bawah:
2 anak = satu di atas, satu di bawah; 3 anak = atas, tengah, bawah. Aturan yang
sama berlaku rekursif untuk setiap level. Gunakan `--ascii` untuk karakter
klasik `+ - |`, atau `--max-label N` untuk membatasi panjang teks node.

```text
                                              ┌─────[ Canvas 2D ]
                          ┌────[ Renderer ] ▾─┼─────[ Bezier edge ]
                          │                   └─────[ Zoom & pan ]
                          │
[ FreeMind Web Canvas ] ▾─┼────[ Model ] ▾─┬───[ Node tree ] ▸
                          │                 └───[ .mm parse/emit ]
                          │
                          └────[ Interaksi ] ▾─┬──[ Enter = sibling ]
                                              └──[ Tab = child ]
```

### 8. Membuka Interactive TUI Window
Membuka antarmuka terminal interaktif layar penuh dengan navigasi keyboard dua panel dan **Interactive Command Bar** persisten di bagian bawah. Tambahkan `--canvas` untuk langsung membuka tampilan mindmap 2D, atau `--ascii` untuk karakter klasik:
```bash
fmap ui <map_id>
fmap ui <map_id> --canvas
```

#### Navigasi & Kontrol Keyboard:
* **Navigasi Cepat**: Tombol panah `↑` / `↓` atau huruf `j` / `k`.
* **Lipat / Buka Cabang**: Tekan `Space` (*fold / unfold*).
* **Aktifkan Input Command Bar**: Tekan `/` (atau `:`), ketik perintah slash, lalu tekan `Enter`.
* **Shortcut Cepat (Otomatis Membuka Command Bar)**:
  * `Tab`: Langsung membuka command `/anak ` untuk menambah sub-cabang.
  * `Enter`: Langsung membuka command `/sejajar ` untuk menambah cabang sejajar (sibling).
  * `e`: Langsung membuka command `/edit <teks>` untuk mengubah teks cabang aktif.
  * `d`: Langsung membuka command `/hapus` untuk menghapus cabang aktif.
  * `n`: Langsung membuka command `/peta ` untuk membuat peta baru.
  * `m`: Langsung membuka command `/buka ` untuk beralih ke peta lain.
  * `v`: Beralih tampilan antara **Outliner** dan **Canvas 2D** (mindmap gaya DOS).
* **Navigasi Canvas 2D**: `↑` `↓` `←` `→` berpindah antar-node secara spasial, `Space` melipat cabang.
* **Keluar**: Tekan `q` atau jalankan `/keluar`.

#### Daftar Perintah Slash Command (`/command`) di TUI:
| Slash Command | Fungsi | Contoh |
| :--- | :--- | :--- |
| `/anak <teks>` | Menambahkan cabang anak baru di bawah node aktif | `/anak Autentikasi Pengguna` |
| `/sejajar <teks>` | Menambahkan cabang sejajar (*sibling*) di level yang sama | `/sejajar Dokumentasi API` |
| `/edit <teks>` | Mengubah teks/label pada node aktif | `/edit Backend Service v2` |
| `/catatan <teks>` | Menambah atau mengubah catatan panjang (*note*) pada node aktif | `/catatan Gunakan OAuth2 & JWT` |
| `/hapus` | Menghapus node aktif beserta seluruh sub-cabangnya | `/hapus` |
| `/peta <nama>` | Membuat mind map baru dan langsung membukanya di TUI | `/peta Roadmap 2027` |
| `/buka <nomor\|id>` | Beralih dan membuka peta lain dari database | `/buka 1` atau `/buka map_xyz` |
| `/cari <query>` | Mencari kata kunci dan otomatis melompat ke node tersebut | `/cari database` |
| `/lipat` | Melipat atau membuka lipatan cabang aktif (*fold/unfold*) | `/lipat` |
| `/bantuan` | Menampilkan ringkasan seluruh perintah slash command | `/bantuan` |
| `/keluar` | Keluar dari antarmuka TUI | `/keluar` |

---

## 📖 Panduan Lengkap Perintah CLI

### 1. Manajemen Peta (`fmap map`)
| Perintah | Deskripsi |
| :--- | :--- |
| `fmap map list` | Menampilkan seluruh peta yang tersimpan beserta jumlah node & edge. |
| `fmap map import <file.mm> [-t title]` | Mengimpor file XML `.mm` ke dalam graf. |
| `fmap map export <map_id> -o <file>` | Mengekspor graf ke format `.mm`, `.svg`, atau `.json`. |
| `fmap map delete <map_id>` | Menghapus peta beserta seluruh node & relasinya dari database. |

### 2. Tampilan Terminal (`fmap view`, `fmap canvas` & `fmap ui`)
| Perintah | Deskripsi |
| :--- | :--- |
| `fmap view <map_id>` | Menampilkan pohon hierarki Unicode Outliner. |
| `fmap view <map_id> --depth N` | Membatasi kedalaman tampilan cabang hingga level $N$. |
| `fmap canvas <map_id>` | Menampilkan mindmap 2D gaya DOS (root kiri, cabang kanan, atas/bawah). |
| `fmap canvas <map_id> --ascii` | Sama, tetapi memakai karakter klasik `+ - |`. |
| `fmap canvas <map_id> --max-label N` | Membatasi panjang teks node (default 40 karakter). |
| `fmap ui <map_id>` | Membuka jendela Interactive TUI terminal layar penuh (tekan `v` untuk Canvas 2D). |
| `fmap ui <map_id> --canvas` | Langsung membuka TUI dalam mode Canvas 2D (tambahkan `--ascii` untuk gaya DOS klasik). |

### 3. Fitur AI Agent & Graph Reasoning
| Perintah | Deskripsi |
| :--- | :--- |
| `fmap context <node_id> [--hops N]` | Mengambil subgraf tetangga $N$-hop di sekitar node (format JSON ringkas untuk prompt LLM). |
| `fmap path <node_a> <node_b>` | Menemukan jalur relasi inferensi terpendek (*shortest path*) antara dua cabang. |
| `fmap search "<query>"` | Pencarian teks instan menggunakan indeks Full-Text Search (FTS5) dengan snippet penyorot kata kunci. |
| `fmap cypher "<query>"` | Menjalankan kueri graf berbasis Cypher langsung di terminal. |

### 4. Manipulasi Node Langsung
| Perintah | Deskripsi |
| :--- | :--- |
| `fmap node add <map_id> <parent_id> "Teks"` | Menambahkan cabang anak baru di bawah parent. |
| `fmap node edit <map_id> <node_id> "Teks"` | Mengubah label teks cabang. |
| `fmap node rm <map_id> <node_id>` | Menghapus cabang dari graf. |

### 5. Opsi Global
* `--db <path>`: Menentukan lokasi file database (default: `./mindmaps.lbug` atau `./mindmaps.db`).
* `--engine <type>`: Memilih engine graf:
  - `auto` (default): Menggunakan **LadybugDB** secara otomatis jika driver `@ladybugdb/core` terpasang, dengan *graceful fallback* ke embedded **SQLite Graph** jika dijalankan dalam mode standalone binary tanpa dependensi eksternal.
  - `ladybug`: Memaksa penggunaan native Cypher graph engine LadybugDB (`@ladybugdb/core` / `kuzu`).
  - `sqlite`: Memaksa penggunaan embedded SQLite Graph engine bawaan Node.js (`node:sqlite`).

---

## 🤝 Kolaborasi Realtime: Pengguna di TUI + Agent di CLI

Sistem ini dirancang khusus untuk skenario **Human-in-the-Loop** bersama AI Agent:
1. **Konkurensi Tanpa Lock**: Database SQLite berjalan dalam mode **WAL (`Write-Ahead Logging`)** dengan `busy_timeout = 5000ms`, sehingga proses eksternal dapat membaca dan menulis kapan saja tanpa memblokir TUI yang sedang dibuka oleh pengguna.
2. **Auto-Refresh Live**: TUI secara otomatis memantau commit eksternal menggunakan `PRAGMA data_version`. Jika AI Agent (atau skrip terminal lain) menambahkan cabang atau mengubah teks via `./cli/dist/fmap node ...`, layar TUI pengguna akan **otomatis me-refresh dan menampilkan perubahan tersebut secara live (< 1 detik)** dengan notifikasi:
   ```text
   🔄 Peta diperbarui oleh proses lain.
   ```
3. **Contoh Alur Kerja**:
   * Pengguna membuka TUI di Terminal 1: `fmap ui map_123`
   * AI Agent bekerja di background / Terminal 2:
     ```bash
     fmap node add map_123 ID_root "Hasil Analisis Agent"
     fmap node add map_123 ID_root "Daftar Tugas Baru"
     ```
   * Pengguna langsung melihat kedua cabang baru tersebut muncul di layar TUI seketika tanpa perlu menekan tombol apa pun.

---

## 🧪 Menjalankan Pengujian Otomatis

Suite pengujian mencakup 11 skenario terotomasi (schema, import/export round-trip, outliner view, FTS5 search, k-hop traversal, shortest path, mutasi node, render SVG, dan layout Canvas 2D):

```bash
node cli/test/cli_test.mjs
```
