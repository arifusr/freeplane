#!/usr/bin/env bash
# ==============================================================================
# Installer Resmi fmap (Freeplane / FreeMind CLI & Graph Engine)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/arifusr/freeplane/main/install.sh | bash
#
# Opsi Tambahan:
#   bash install.sh --system     # Pasang ke /usr/local/bin (perlu akses root/sudo)
#   bash install.sh --uninstall  # Hapus binary fmap
# ==============================================================================

set -euo pipefail

REPO="arifusr/freeplane"
BINARY_NAME="fmap"
INSTALL_DIR="${HOME}/.local/bin"
USE_SYSTEM=false
UNINSTALL=false
REQUESTED_TAG=""

# Parse argumen baris perintah
while [[ $# -gt 0 ]]; do
  case "$1" in
    --system)
      USE_SYSTEM=true
      INSTALL_DIR="/usr/local/bin"
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --version)
      REQUESTED_TAG="$2"
      shift 2
      ;;
    -h|--help)
      echo "Installer fmap - Freeplane CLI & Graph Engine"
      echo ""
      echo "Penggunaan:"
      echo "  bash install.sh [opsi]"
      echo ""
      echo "Opsi:"
      echo "  --system       Pasang secara global ke /usr/local/bin"
      echo "  --uninstall    Hapus binary fmap yang terpasang"
      echo "  --version TAG  Pasang versi rilis tertentu (contoh: v1.0.0)"
      echo "  -h, --help     Tampilkan bantuan ini"
      exit 0
      ;;
    *)
      echo "Opsi tidak dikenal: $1"
      exit 1
      ;;
  esac
done

# ANSI Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

if [ "$UNINSTALL" = true ]; then
  TARGET_PATH="${INSTALL_DIR}/${BINARY_NAME}"
  if [ -f "$TARGET_PATH" ]; then
    echo -e "${YELLOW}Menghapus ${TARGET_PATH}...${NC}"
    if [ "$USE_SYSTEM" = true ] && [ "$EUID" -ne 0 ]; then
      sudo rm -f "$TARGET_PATH"
    else
      rm -f "$TARGET_PATH"
    fi
    echo -e "${GREEN}✔ ${BINARY_NAME} berhasil dihapus.${NC}"
  else
    echo -e "${RED}File binary ${TARGET_PATH} tidak ditemukan.${NC}"
  fi
  exit 0
fi

echo -e "${BOLD}${CYAN}🧠 Memulai Pemasangan fmap CLI (Native Rust & LadybugDB)...${NC}"

# 1. Deteksi Sistem Operasi & Arsitektur
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

if [ "$OS" != "linux" ]; then
  echo -e "${RED}Error: Saat ini installer ini hanya mendukung Linux.${NC}" >&2
  exit 1
fi

case "$ARCH" in
  x86_64|amd64)
    ARCH_TARGET="x86_64"
    ;;
  aarch64|arm64)
    ARCH_TARGET="aarch64"
    ;;
  *)
    echo -e "${RED}Error: Arsitektur '${ARCH}' tidak didukung.${NC}" >&2
    exit 1
    ;;
esac

echo -e "  • Sistem Operasi : ${BOLD}Linux${NC}"
echo -e "  • Arsitektur CPU : ${BOLD}${ARCH_TARGET}${NC}"
echo -e "  • Lokasi Target  : ${BOLD}${INSTALL_DIR}/${BINARY_NAME}${NC}"

# 2. Tentukan Versi Rilis
if [ -n "$REQUESTED_TAG" ]; then
  TAG="$REQUESTED_TAG"
  DOWNLOAD_BASE="https://github.com/${REPO}/releases/download/${TAG}"
else
  DOWNLOAD_BASE="https://github.com/${REPO}/releases/latest/download"
fi

ASSET_NAME="fmap-linux-${ARCH_TARGET}.tar.gz"
DOWNLOAD_URL="${DOWNLOAD_BASE}/${ASSET_NAME}"
CHECKSUM_URL="${DOWNLOAD_BASE}/${ASSET_NAME}.sha256"

# 3. Unduh Artefak ke Direktori Sementara
TMP_DIR="$(mktemp -d -t fmap-install-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo -e "\n${CYAN}⬇ Mengunduh arsip rilis (~8.6 MB)...${NC}"
if ! curl -fSL --progress-bar "$DOWNLOAD_URL" -o "${TMP_DIR}/${ASSET_NAME}"; then
  echo -e "${RED}Gagal mengunduh arsip dari: ${DOWNLOAD_URL}${NC}" >&2
  echo -e "${YELLOW}Catatan: Pastikan repositori GitHub sudah berstatus publik dan rilis telah dibuat.${NC}" >&2
  exit 1
fi

# 4. Verifikasi Checksum SHA-256 (jika tersedia)
if curl -fsSL "$CHECKSUM_URL" -o "${TMP_DIR}/${ASSET_NAME}.sha256" 2>/dev/null; then
  echo -e "${CYAN}🔒 Memverifikasi checksum SHA-256...${NC}"
  cd "$TMP_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${ASSET_NAME}.sha256" >/dev/null
    echo -e "${GREEN}✔ Verifikasi checksum SHA-256 berhasil!${NC}"
  fi
  cd - >/dev/null
fi

# 5. Ekstraksi Binary
tar -xzf "${TMP_DIR}/${ASSET_NAME}" -C "$TMP_DIR"
if [ ! -f "${TMP_DIR}/${BINARY_NAME}" ]; then
  echo -e "${RED}Error: Binary ${BINARY_NAME} tidak ditemukan di dalam arsip tar.gz.${NC}" >&2
  exit 1
fi

chmod +x "${TMP_DIR}/${BINARY_NAME}"

# 6. Pasang Binary ke Direktori Target
mkdir -p "$INSTALL_DIR"
if [ "$USE_SYSTEM" = true ] && [ "$EUID" -ne 0 ]; then
  echo -e "${CYAN}Memasang ke ${INSTALL_DIR} menggunakan sudo...${NC}"
  sudo cp "${TMP_DIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
else
  cp "${TMP_DIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo -e "\n${BOLD}${GREEN}🎉 SUKSES! fmap berhasil dipasang di: ${INSTALL_DIR}/${BINARY_NAME}${NC}"

# 7. Periksa apakah INSTALL_DIR ada di PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo -e "\n${YELLOW}Perhatian: ${INSTALL_DIR} belum ada di dalam variabel environment PATH Anda.${NC}"
  echo -e "Tambahkan baris berikut ke file konfigurasi shell Anda (~/.bashrc atau ~/.zshrc):"
  echo -e "${BOLD}  export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
  echo -e "Lalu muat ulang shell dengan: ${BOLD}source ~/.bashrc${NC}\n"
else
  echo -e "Jalankan perintah ini untuk mulai menggunakan:"
  echo -e "${BOLD}  fmap --help${NC}\n"
fi

