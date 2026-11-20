# Freeplane / FreeMind Web & CLI Workspace

Workspace pengembangan ulang Freeplane / FreeMind menjadi:
1. **Web Canvas**: Aplikasi mind map interaktif berbasis web (HTML5 Canvas 2D + SVG export).
2. **CLI & Graph Engine (`fmap`)**: Antarmuka baris perintah berbasis database graf (LadybugDB / SQLite) dengan visualisasi Outliner Tree dan Interactive TUI Window di terminal.

---

## 📂 Struktur Repositori

* **[cli/](file:///home/arifusr/freeplane/cli/)**: Source code utilitas CLI `fmap`, engine database graf, visualizer outliner, dan TUI terminal.
  * Panduan lengkap: [cli/README.md](file:///home/arifusr/freeplane/cli/README.md).
* **[renv/projects/freemind-web-canvas/](file:///home/arifusr/freeplane/renv/projects/freemind-web-canvas/)**: Aplikasi FreeMind Web Canvas (core engine [freemind-core.mjs](file:///home/arifusr/freeplane/renv/projects/freemind-web-canvas/src/freemind-core.mjs) dan UI [index.html](file:///home/arifusr/freeplane/renv/projects/freemind-web-canvas/src/index.html)).
* **[research/freemind-src/](file:///home/arifusr/freeplane/research/freemind-src/)**: Source code Java FreeMind referensi untuk menjaga parity algoritma layout dan parsing XML.
* **[renv-tutorial-id/](file:///home/arifusr/freeplane/renv-tutorial-id/)**: Dokumentasi dan tutorial riset `renv` dalam bahasa Indonesia.

---

## ⚡ Panduan Cepat Menjalankan CLI (`fmap`)

### 1. Menjalankan Perintah CLI
Pastikan Anda berada di direktori proyek ini. Utilitas CLI dapat langsung dipanggil:

```bash
# Menampilkan menu bantuan
./cli/bin/fmap.mjs --help

# Impor file mind map .mm ke database graf
./cli/bin/fmap.mjs map import renv/projects/freemind-web-canvas/src/sample.mm -t "Proyek Utama"

# Tampilkan daftar peta tersimpan
./cli/bin/fmap.mjs map list

# Tampilkan struktur pohon hierarki (Outliner) di terminal
./cli/bin/fmap.mjs view <map_id>

# Tampilkan mindmap 2D gaya DOS (root kiri, cabang kanan, atas/bawah)
./cli/bin/fmap.mjs canvas <map_id>

# Buka antarmuka interaktif TUI layar penuh (tekan v = Canvas 2D)
./cli/bin/fmap.mjs ui <map_id>
```

### 2. Membuat Shortcut / Alias Global (Opsional)
Agar dapat memanggil `fmap` dari folder mana pun tanpa path panjang:

```bash
# Opsi A: Tambahkan alias di shell Anda (~/.bashrc)
alias fmap="$(pwd)/cli/bin/fmap.mjs"

# Opsi B: Menggunakan npm link
cd cli && npm link
```

Setelah itu Anda cukup mengetik `fmap view <map_id>`.

---

## 🌐 Menjalankan Versi Web Canvas

```bash
cd renv/projects/freemind-web-canvas/src
python3 -m http.server 8000
```
Buka browser pada `http://localhost:8000`.

---

## 🧪 Pengujian

* **Pengujian CLI & Graph Engine**:
  ```bash
  node cli/test/cli_test.mjs
  ```
* **Pengujian Web Canvas Parity**:
  ```bash
  cd renv/projects/freemind-web-canvas && node test/features_check.mjs
  ```
