# Panduan Kerja & Arsitektur Build Release (`fmap-rs`)

Dokumen ini menjelaskan secara menyeluruh bagaimana proses **build asset release** bekerja untuk `fmap` versi Rust, mulai dari resolusi dependensi C++ native LadybugDB, optimasi profile compiler, hingga pemaketan arsip distribusi dan checksum.

---

## 🏗️ Alur Kerja Build Release (Pipeline Overview)

```
┌────────────────────────────────────────────────────────┐
│ 1. PRASYARAT LINGKUNGAN (Toolchain & Build Tools)      │
│    Rust Stable, GCC/G++ (C++17), CMake, OpenSSL dev    │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 2. RESOLUSI DEPENDENSI NATIVE (LadybugDB Engine)       │
│    Crate `lbug` -> Prebuilt `liblbug.a` / CMake source │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 3. OPTIMASI KOMPILASI RUST (Cargo Release Profile)     │
│    opt-level=3, LTO, codegen-units=1, panic=abort      │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 4. LINKING & STRIPPING                                 │
│    Linker statis liblbug.a + shared stdc++, strip ELF  │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 5. VERIFIKASI BINARY (Sanity Checks)                   │
│    ldd check (glibc), fmap --version, smoke test       │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 6. PEMAKETAN ARSIP RILIS & CHECKSUM                    │
│    fmap-linux-x86_64.tar.gz + .sha256 hash             │
└────────────────────────────────────────────────────────┘
```

---

## 1. Prasyarat Lingkungan (Host Dependencies)

Untuk membangun binary release `fmap`, host atau runner CI harus memiliki:

| Komponen | Versi Minimal | Fungsi |
| :--- | :--- | :--- |
| **Rust Toolchain** | `>= 1.80` (disarankan stable terbaru) | Compiler `rustc` dan package manager `cargo` |
| **CMake** | `>= 3.20` | Dibutuhkan oleh build script crate `lbug` |
| **GCC / G++** | `>= 11` (mendukung C++17/C++20) | Kompilasi/linking runtime engine LadybugDB |
| **OpenSSL Dev** | `libssl-dev` / `openssl-devel` | Kebutuhan enkripsi transport LadybugDB |
| **GNU Tar & SHA256** | `tar`, `gzip`, `sha256sum` | Pemaketan arsip distribusi |

---

## 2. Resolusi Dependensi Native C++ (`lbug` / LadybugDB)

Crate `lbug` adalah binding Rust resmi di atas core engine LadybugDB yang ditulis dalam C++. Ada 2 mode resolusi di build script `lbug` (`build.rs`):

1. **Mode Prebuilt Static Library (Cepat, ~1-2 menit total build)**:
   * Build script `lbug` mencoba mengunduh arsip pustaka statis `liblbug.a` sesuai arsitektur OS.
   * Jika tersedia, library disimpan di cache build Cargo dan dipakai saat linking.
2. **Mode Fallback dari Source (Lambat, ~15-20 menit)**:
   * Jika unduhan prebuilt gagal atau arsip tidak tersedia, `build.rs` melanjutkan build dari source menggunakan `cmake`.
   * Release workflow mengandalkan fallback bawaan ini; tidak melakukan pre-fetch terpisah yang akan menghentikan job saat unduhan gagal.

---

## 3. Optimasi Kompilasi (`Cargo.toml`)

Konfigurasi profile rilis diatur untuk menghasilkan binary sekecil dan secepat mungkin:

```toml
[profile.release]
opt-level = 3          # Optimasi kecepatan maksimal
lto = "thin"           # Link-Time Optimization antar-crate
codegen-units = 1      # Memaksimalkan efektivitas LTO
panic = "abort"        # Menghapus stack unwinding logic (memangkas ~1-2 MB)
strip = true           # Otomatis strip seluruh simbol debug dari ELF binary
```

### Dampak Optimasi:
* Menghilangkan dead-code lintas dependensi (`clap`, `quick-xml`, `ratatui`, `serde`).
* Binary unstripped awal: **~29 MB** $\rightarrow$ Binary stripped: **~24 MB**.

---

## 4. Proses Linking & Kompatibilitas Glibc

Saat binary `fmap` di-link:
* `liblbug.a` digabungkan secara statis ke dalam binary.
* Shared library sistem yang di-link secara dinamis:
  * `libc.so.6` (kompatibel mulai dari **GLIBC >= 2.28**, mencakup Ubuntu 20.04+, 22.04+, 24.04+, Debian 10+, Fedora, Arch).
  * `libstdc++.so.6`
  * `libatomic.so.1`
  * `libssl.so` & `libcrypto.so`

Verifikasi dynamic linking dapat dilakukan dengan:
```bash
ldd fmap
```

---

## 5. Pemaketan Aset Rilis (Release Packaging)

Setelah binary `fmap` selesai dikompilasi, proses packaging menghasilkan **dua berkas utama** per arsitektur:

### 1. Arsip Terkompresi (`tar.gz`)
Format tarball gzip dengan level kompresi tinggi:
```bash
tar -czf fmap-linux-x86_64.tar.gz -C target/release fmap
```
* **Ukuran Asli Executable**: ~24 MB
* **Ukuran Arsip `tar.gz`**: **~8.6 MB** (Hemat transfer data >64%)

### 2. Checksum SHA-256
File tanda tangan digital untuk integritas dan keamanan:
```bash
sha256sum fmap-linux-x86_64.tar.gz > fmap-linux-x86_64.tar.gz.sha256
```
Isi file:
```text
<hash_64_karakter_hex>  fmap-linux-x86_64.tar.gz
```

---

## 6. Naming Convention Aset

Aset rilis mengikuti konvensi penamaan standar agar dapat dideteksi secara deterministik oleh skrip instalasi maupun package manager:

| Target Platform | Nama Arsip | Nama File Checksum |
| :--- | :--- | :--- |
| **Linux x86_64 (amd64)** | `fmap-linux-x86_64.tar.gz` | `fmap-linux-x86_64.tar.gz.sha256` |
| **Linux aarch64 (arm64)** | `fmap-linux-aarch64.tar.gz` | `fmap-linux-aarch64.tar.gz.sha256` |
| **Linux musl (Static)** | `fmap-linux-x86_64-musl.tar.gz` | `fmap-linux-x86_64-musl.tar.gz.sha256` |

---

## 7. Eksekusi Build Release Lokal

Untuk menjalankan seluruh langkah build di atas secara lokal, telah disediakan skrip otomatis:

```bash
# Jalankan dari root workspace
./fmap-rs/scripts/build-release.sh

# Atau dari dalam direktori fmap-rs/
cd fmap-rs && ./scripts/build-release.sh
```

Aset hasil rilis akan langsung diletakkan di direktori:
* `fmap-rs/dist/fmap-linux-x86_64.tar.gz`
* `fmap-rs/dist/fmap-linux-x86_64.tar.gz.sha256`

