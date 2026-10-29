#!/bin/bash
# SeamCast starten (macOS): Doppelklick im Finder. Aktualisiert, installiert, startet neu bei Absturz.
cd "$(dirname "$0")" || exit 1
# Homebrew liegt bei Doppelklick oft nicht im Suchpfad (Apple Silicon: /opt/homebrew, Intel: /usr/local)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=== SeamCast wird gestartet ==="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Installation: https://nodejs.org (Version 22.13 oder neuer)"
  echo "oder mit Homebrew:  brew install node"
  read -r -p "Enter zum Beenden ..." _
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm wird installiert ..."
  corepack enable pnpm 2>/dev/null || npm install -g pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm konnte nicht installiert werden. Bitte im Terminal ausfuehren:  npm install -g pnpm"
    read -r -p "Enter zum Beenden ..." _
    exit 1
  fi
fi

echo "Suche nach Updates ..."
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  if ! git checkout main; then
    echo "Der Wechsel auf \"main\" hat nicht geklappt, vermutlich wegen eigener Aenderungen im Ordner."
    echo "SeamCast startet mit dem bisherigen Stand. Bitte die Meldung oben ansehen."
    read -r -p "Enter zum Fortfahren ..." _
  fi
  git pull --ff-only
fi

echo "Pruefe Abhaengigkeiten ..."
if ! pnpm install --frozen-lockfile; then
  echo "Installation fehlgeschlagen. Bitte die Meldung oben ansehen."
  read -r -p "Enter zum Beenden ..." _
  exit 1
fi

# Browser einmalig oeffnen, sobald der Server oben ist
( sleep 4; open "http://127.0.0.1:8080/control/" ) &

while true; do
  echo
  echo "SeamCast laeuft. Zum Beenden dieses Fenster schliessen."
  pnpm start
  echo
  echo "SeamCast wurde beendet oder ist abgestuerzt. Neustart in 3 Sekunden ..."
  sleep 3
done
