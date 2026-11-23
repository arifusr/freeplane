<?xml version="1.0" encoding="UTF-8"?>
<map version="freeplane 1.9.0">
	<node ID="ID_1a2067695f8_root" TEXT="Alur Kerja Build Asset Release fmap-rs">
		<node ID="ID_18ea8f20342f2e45" TEXT="6. Otomasi Build (Lokal &amp; CI/CD)">
			<node ID="ID_18ea8f2068b15c40" TEXT="Upload Otomatis: softprops/action-gh-release ke GitHub Releases"/>
			<node ID="ID_18ea8f205ea4084e" TEXT="Pemicu Rilis: Git tag push (contoh: git push origin v1.0.0)"/>
			<node ID="ID_18ea8f20525deff3" TEXT="Pipeline CI/CD: .github/workflows/release.yml"/>
			<node ID="ID_18ea8f204895e9a2" TEXT="Proteksi Disk: Alokasi CARGO_TARGET_DIR di /tmp"/>
			<node ID="ID_18ea8f203e4ad9d7" TEXT="Skrip Lokal: ./fmap-rs/scripts/build-release.sh"/>
		</node>
		<node ID="ID_18ea8f1ff668a0f3" TEXT="5. Pemaketan Arsip Distribusi &amp; Checksum">
			<node ID="ID_18ea8f202969259a" TEXT="Direktori Output Distribusi: fmap-rs/dist/"/>
			<node ID="ID_18ea8f201dfdb672" TEXT="File Checksum: fmap-linux-x86_64.tar.gz.sha256"/>
			<node ID="ID_18ea8f2013e4ef7b" TEXT="Perhitungan Hash: sha256sum fmap-linux-x86_64.tar.gz"/>
			<node ID="ID_18ea8f200a5c6e71" TEXT="Ukuran Download: Terpangkas dari 23 MB ke hanya 8.5 MB (~63% hemat)"/>
			<node ID="ID_18ea8f20005cc379" TEXT="Kompresi Tarball: tar -czf fmap-linux-x86_64.tar.gz"/>
		</node>
		<node ID="ID_18ea8f1fb948b968" TEXT="4. Stripping Simbol &amp; Smoke Test">
			<node ID="ID_18ea8f1fece489a3" TEXT="Penyalinan Biner: target/release/fmap -&gt; fmap-rs/bin/fmap"/>
			<node ID="ID_18ea8f1fe305bc1c" TEXT="Smoke Test Bantuan: fmap --help"/>
			<node ID="ID_18ea8f1fd928d55d" TEXT="Smoke Test Eksekusi: fmap --version"/>
			<node ID="ID_18ea8f1fcf09437f" TEXT="Verifikasi Dynamic Link: ldd fmap (glibc &gt;= 2.28)"/>
			<node ID="ID_18ea8f1fc2fe5cfa" TEXT="Stripping Simbol ELF: Memangkas ukuran binary ke ~23 MB"/>
		</node>
		<node ID="ID_18ea8f1f7c66d9f7" TEXT="3. Optimasi Kompilasi Cargo Release">
			<node ID="ID_18ea8f1faf456b29" TEXT="strip = true (Hapus tabel simbol debug dari biner)"/>
			<node ID="ID_18ea8f1fa55cd24d" TEXT="panic = 'abort' (Hapus logika unwinding, pangkas ~1-2 MB)"/>
			<node ID="ID_18ea8f1f9b518121" TEXT="codegen-units = 1 (Maksimalkan reduksi dead-code)"/>
			<node ID="ID_18ea8f1f90dedf85" TEXT="lto = 'thin' (Link-Time Optimization lintas dependensi)"/>
			<node ID="ID_18ea8f1f868ab02c" TEXT="opt-level = 3 (Optimasi performa &amp; kecepatan CPU)"/>
		</node>
		<node ID="ID_18ea8f1f3f2a7770" TEXT="2. Resolusi Dependensi Native (LadybugDB)">
			<node ID="ID_18ea8f1f727097fb" TEXT="Keuntungan Prebuilt: Waktu build terpangkas dari ~15m jadi &lt;2m"/>
			<node ID="ID_18ea8f1f68b10c5f" TEXT="Mode Fallback: Kompilasi CMake dari source tree (500k LOC)"/>
			<node ID="ID_18ea8f1f5ecc47a8" TEXT="Cache Lokal: .cache/lbug-prebuilt/latest-compat/lib/"/>
			<node ID="ID_18ea8f1f53210e1b" TEXT="Mode Prebuilt Static Library: liblbug.a via download_lbug.sh"/>
			<node ID="ID_18ea8f1f492d7119" TEXT="Crate lbug 0.22.3 (Binding Rust ke Core C++ LadybugDB)"/>
		</node>
		<node ID="ID_18ea8f1f01f31b23" TEXT="1. Prasyarat Host &amp; Lingkungan">
			<node ID="ID_18ea8f1f35996db7" TEXT="Utilities: tar, gzip, sha256sum, strip"/>
			<node ID="ID_18ea8f1f2ba34c5c" TEXT="Library Sistem: OpenSSL Dev (libssl-dev) &amp; libatomic"/>
			<node ID="ID_18ea8f1f218b6bd5" TEXT="Build Tool: CMake &gt;= 3.20 &amp; Make"/>
			<node ID="ID_18ea8f1f1701b4f9" TEXT="Compiler C++17/20: GCC/G++ &gt;= 11 atau Clang"/>
			<node ID="ID_18ea8f1f0cb270ad" TEXT="Rust Toolchain Stable &gt;= 1.80 (cargo, rustc)"/>
		</node>
	</node>
</map>
