#!/usr/bin/env bash
# ==============================================================================
# Script Build Release fmap-rs
# Membangun binary release, melakukan strip, verifikasi, dan memaketkan aset
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FMAP_RS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="${FMAP_RS_DIR}/dist"
TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/cargo-target-fmap}"

# ANSI Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}🔨 [1/5] Memulai Proses Build Asset Release fmap-rs...${NC}"

# 1. Deteksi Lingkungan & Arsitektur
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)
    ARCH_NAME="x86_64"
    ;;
  aarch64|arm64)
    ARCH_NAME="aarch64"
    ;;
  *)
    ARCH_NAME="$ARCH"
    ;;
esac

echo -e "  • Direktori Proyek: ${FMAP_RS_DIR}"
echo -e "  • Target Output   : ${TARGET_DIR}"
echo -e "  • Arsitektur      : ${ARCH_NAME}"

# 2. Persiapan Direktori Output
mkdir -p "$DIST_DIR"
mkdir -p "$TARGET_DIR"

# 3. Kompilasi Release dengan Cargo
echo -e "\n${BOLD}${CYAN}⚡ [2/5] Mengompilasi binary release dengan Cargo (LTO & opt-level=3)...${NC}"
cd "$FMAP_RS_DIR"

# Pastikan PATH compiler aktif jika ada toolchain lokal
if [ -d "/home/arifusr/freeplane/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin" ]; then
  export PATH="/home/arifusr/freeplane/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:$PATH"
fi
if [ -d "/home/arifusr/freeplane/.cargo" ]; then
  export CARGO_HOME="/home/arifusr/freeplane/.cargo"
fi

export CARGO_TARGET_DIR="$TARGET_DIR"

cargo build --release

RELEASE_BIN="${TARGET_DIR}/release/fmap"
if [ ! -f "$RELEASE_BIN" ]; then
  echo -e "${RED}Error: Binary release tidak ditemukan di ${RELEASE_BIN}${NC}" >&2
  exit 1
fi

# 4. Strip Simbol Debug & Smoke Test
echo -e "\n${BOLD}${CYAN}✂️  [3/5] Melakukan stripping simbol debug pada binary ELF...${NC}"
strip "$RELEASE_BIN" 2>/dev/null || true

BIN_SIZE="$(du -h "$RELEASE_BIN" | cut -f1)"
echo -e "  ✔ Ukuran binary stripped: ${BOLD}${BIN_SIZE}${NC}"

echo -e "\n${BOLD}${CYAN}🧪 [4/5] Menjalankan smoke test binary...${NC}"
"$RELEASE_BIN" --version
"$RELEASE_BIN" --help >/dev/null
echo -e "${GREEN}✔ Smoke test berhasil (binary dapat dieksekusi normal).${NC}"

# Salin juga ke fmap-rs/bin/fmap untuk kenyamanan lokal
mkdir -p "${FMAP_RS_DIR}/bin"
cp "$RELEASE_BIN" "${FMAP_RS_DIR}/bin/fmap"

# 5. Pemaketan Aset Rilis (tar.gz + sha256)
echo -e "\n${BOLD}${CYAN}📦 [5/5] Memaketkan aset rilis dan menghitung SHA-256...${NC}"
ARCHIVE_NAME="fmap-linux-${ARCH_NAME}.tar.gz"
ARCHIVE_PATH="${DIST_DIR}/${ARCHIVE_NAME}"
CHECKSUM_PATH="${DIST_DIR}/${ARCHIVE_NAME}.sha256"

tar -czf "$ARCHIVE_PATH" -C "${TARGET_DIR}/release" fmap
cd "$DIST_DIR"
sha256sum "$ARCHIVE_NAME" > "$CHECKSUM_PATH"

ARCHIVE_SIZE="$(du -h "$ARCHIVE_PATH" | cut -f1)"
HASH_VALUE="$(cut -d' ' -f1 < "$CHECKSUM_PATH")"

echo -e "\n${BOLD}${GREEN}🎉 PROSES BUILD RELEASE SELESAI DENGAN SUKSES!${NC}"
echo -e "────────────────────────────────────────────────────────────"
echo -e "  • Arsip Rilis     : ${BOLD}${ARCHIVE_PATH}${NC} (${ARCHIVE_SIZE})"
echo -e "  • Checksum SHA256 : ${BOLD}${CHECKSUM_PATH}${NC}"
echo -e "  • Nilai Hash      : ${CYAN}${HASH_VALUE}${NC}"
echo -e "  • Binary Lokal    : ${FMAP_RS_DIR}/bin/fmap"
echo -e "────────────────────────────────────────────────────────────\n"

