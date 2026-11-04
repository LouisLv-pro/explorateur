#!/usr/bin/env bash
# Fait d'explorateur l'app par défaut des extensions qu'il déclare (spec ouvrir-depuis-finder.md).
#
# Les extensions sont lues dans l'Info.plist de l'app installée (CFBundleDocumentTypes, écrit
# par `bundle.fileAssociations` de tauri.conf.json) : une seule liste à tenir à jour.
# Relancer le script ne change rien de plus. Requiert duti (brew install duti).
set -euo pipefail

BUNDLE_ID="app.explorateur.mac"
# `EXPLORATEUR_APP` ne sert qu'à tester le script sur une autre copie de l'app.
APP="${EXPLORATEUR_APP:-/Applications/explorateur.app}"
PLIST="$APP/Contents/Info.plist"

if ! command -v duti >/dev/null 2>&1; then
  echo "Installer duti : brew install duti" >&2
  exit 1
fi

if [[ ! -f "$PLIST" ]]; then
  echo "explorateur n'est pas installée : $APP est introuvable." >&2
  exit 1
fi

# `plutil` rend le tableau en JSON compact ; les extensions sont de simples mots, on les
# isole sans outil JSON : chaque `"CFBundleTypeExtensions":[...]`, puis les mots entre guillemets.
json="$(plutil -extract CFBundleDocumentTypes json -o - "$PLIST" 2>/dev/null)" || {
  echo "Aucune association de fichier dans $PLIST : reconstruire l'app." >&2
  exit 1
}
extensions="$(
  printf '%s' "$json" |
    grep -Eo '"CFBundleTypeExtensions" *: *\[[^]]*\]' |
    sed -E 's/.*\[//; s/\]//' |
    tr ',' '\n' |
    tr -d '" ' |
    sort -u
)"

if [[ -z "$extensions" ]]; then
  echo "Aucune extension déclarée dans $PLIST : reconstruire l'app." >&2
  exit 1
fi

done_count=0
already=0
refused=()
while IFS= read -r ext; do
  # Déjà à explorateur : rien à demander (macOS ouvrirait une confirmation de plus).
  if duti -x "$ext" 2>/dev/null | grep -qx "$BUNDLE_ID"; then
    already=$((already + 1))
  elif duti -s "$BUNDLE_ID" ".$ext" all >/dev/null 2>&1; then
    done_count=$((done_count + 1))
  else
    refused+=(".$ext")
  fi
done <<<"$extensions"

echo "explorateur est déjà l'app par défaut de $already extension(s)."
if ((done_count > 0)); then
  # Depuis macOS 26, le changement n'a lieu qu'après la confirmation de l'utilisateur.
  echo "$done_count demande(s) envoyée(s) : macOS ouvre une fenêtre par type de fichier,"
  echo "choisir « Utiliser explorateur » dans chacune, puis relancer ce script pour vérifier."
fi
if ((${#refused[@]} > 0)); then
  echo "Refusées par duti : ${refused[*]}" >&2
  exit 1
fi
