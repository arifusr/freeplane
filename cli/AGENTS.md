# AGENTS.md — Protokol Operasional AI Agent untuk `fmap`

File ini adalah panduan resmi bagi **AI Agent** (seperti Antigravity, Claude, Codex, dll.) untuk mengoperasikan, membaca, dan memodifikasi mind map menggunakan CLI **`fmap`**.

---

## 🎯 Peran & Kegunaan `fmap` bagi AI Agent

`fmap` adalah mesin penyimpan struktur pengetahuan (*knowledge graph*) berbasis **Graph Database (SQLite / LadybugDB)**.

Gunakan `fmap` saat:
1. **Perencanaan & Dekomposisi Tugas**: Memecah masalah besar menjadi hierarki cabang ide/tugas.
2. **Penyimpanan Arsitektur Sistem**: Menyimpan komponen backend, frontend, database, dan relasi silangnya.
3. **GraphRAG (Retrieval Hemat Token)**: Mengambil konteks ide tertentu tanpa perlu membaca seluruh file 5000 baris.
4. **Kolaborasi Live**: Menambahkan atau memperbarui cabang secara terprogram di background saat pengguna sedang melihat peta di jendela TUI.

---

## ⚡ Aturan Emas untuk AI Agent (Golden Rules)

1. **Selalu Gunakan Flag `--json`**:
   Semua perintah `fmap` mendukung `--json`. Gunakan flag ini agar output berupa objek terstruktur yang mudah diproses secara komputasi:
   ```bash
   ./cli/dist/fmap map list --json
   ./cli/dist/fmap search "query" --json
   ./cli/dist/fmap node add <map_id> <parent_id> "Teks" --json
   ```

2. **Gunakan `context` untuk Menghemat Token (GraphRAG)**:
   Jangan mengekspor seluruh peta ke prompt. Gunakan perintah `context` untuk mengambil subgraf $N$-hop di sekitar simpul yang relevan:
   ```bash
   ./cli/dist/fmap context <node_id> --hops 2
   ```
   *Output berupa JSON yang memuat parent, anak langsung, tetangga 2-hop, dan relasi silang (arrowlinks).*

3. **Penelusuran Logika & Jalur Penalaran (*Pathfinding*)**:
   Jika ingin mengetahui bagaimana dua ide terhubung dalam graf:
   ```bash
   ./cli/dist/fmap path <node_a> <node_b> --json
   ```

4. **Koneksi Bersama Pengguna (Live Collaboration)**:
   Jika pengguna sedang membuka TUI (`fmap ui`), modifikasi yang Anda lakukan via CLI akan **otomatis muncul di layar pengguna secara live (< 1 detik)** berkat SQLite WAL & `PRAGMA data_version`. Anda tidak perlu meminta pengguna me-refresh.

---

## 🛠️ Alur Kerja Umum Agent (Playbook)

### Skenario A: Pengguna Minta Menambah / Mengubah Isi Peta yang Sedang Dibuka
1. **Periksa State Peta**:
   Agent melihat seluruh struktur pohon dan ID cabang yang sudah ada:
   ```bash
   ./cli/dist/fmap view <mapId> --json
   ```
   *Atau jika mencari cabang tertentu secara cepat:*
   ```bash
   ./cli/dist/fmap search "Backend" --json
   ```
2. **Eksekusi Penambahan / Perubahan Cabang**:
   Setelah mengetahui `parentId` dari state di atas:
   ```bash
   # Menambah sub-tugas di bawah parent
   ./cli/dist/fmap node add <mapId> <parentId> "Setup PostgreSQL" --json

   # Atau mengubah teks node yang sudah ada
   ./cli/dist/fmap node edit <mapId> <targetId> "Backend Service v2" --json
   ```
3. **Konfirmasi ke Pengguna**:
   Beri tahu pengguna bahwa cabang telah ditambahkan. Jika pengguna sedang membuka TUI, perubahan tersebut langsung terlihat di layar mereka secara realtime.

---

### Skenario B: Pengguna Menanyakan Hubungan / Konsep Tertentu
1. Cari kata kunci menggunakan indeks FTS:
   ```bash
   ./cli/dist/fmap search "database" --json
   ```
2. Ambil konteks di sekitar node yang ditemukan:
   ```bash
   ./cli/dist/fmap context <node_id> --hops 2
   ```
3. Jawab pertanyaan pengguna dengan merujuk pada hierarki dan relasi silang yang ditemukan di dalam graf.

---

### Skenario C: Menampilkan Visualisasi ke Pengguna
Jika pengguna meminta diagram peta pikiran:
* Untuk tampilan pohon hierarkis:
  ```bash
  ./cli/dist/fmap view <mapId>
  ```
* Untuk diagram 2D (Root di tengah, cabang atas & bawah):
  ```bash
  ./cli/dist/fmap view2d <mapId>
  ```
* Untuk ekspor gambar vektor SVG:
  ```bash
  ./cli/dist/fmap map export <mapId> -o /tmp/mindmap.svg
  ```

---

## 📋 Ringkasan Perintah CLI Khusus Agent

| Tugas Agent | Perintah yang Digunakan |
| :--- | :--- |
| Mendata seluruh peta | `./cli/dist/fmap map list --json` |
| Membuat peta baru | `./cli/dist/fmap map create "<judul>" --json` |
| Mencari ide/catatan | `./cli/dist/fmap search "<query>" --json` |
| Mengambil subgraf tetangga | `./cli/dist/fmap context <node_id> --hops 2` |
| Mencari jalur penalaran | `./cli/dist/fmap path <node_a> <node_b> --json` |
| Menambah cabang baru | `./cli/dist/fmap node add <map_id> <parent_id> "<teks>" --json` |
| Mengubah teks cabang | `./cli/dist/fmap node edit <map_id> <node_id> "<teks_baru>" --json` |
| Menghapus cabang | `./cli/dist/fmap node rm <map_id> <node_id> --json` |
| Kueri graf langsung | `./cli/dist/fmap cypher "<cypher_query>"` |

