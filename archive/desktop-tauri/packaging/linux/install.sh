#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

mkdir -p "${BIN_DIR}" "${APP_DIR}" "${ICON_DIR}"
install -m 755 "${SCRIPT_DIR}/balacopapo-desktop" "${BIN_DIR}/balacopapo"
if [ -f "${SCRIPT_DIR}/snafuonda.ico" ]; then
  install -m 644 "${SCRIPT_DIR}/snafuonda.ico" "${ICON_DIR}/balacopapo.ico"
fi

sed "s|%h|${HOME}|g" "${SCRIPT_DIR}/balacopapo.desktop" > "${APP_DIR}/balacopapo.desktop"
chmod 644 "${APP_DIR}/balacopapo.desktop"

if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default balacopapo.desktop x-scheme-handler/balacopapo || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APP_DIR}" || true
fi

echo "Balacopapo instalado em ${BIN_DIR}/balacopapo e registrado no menu de aplicativos!"
