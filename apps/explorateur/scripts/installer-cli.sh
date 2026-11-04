#!/usr/bin/env bash
# Installe la commande `explorateur` (spec ouvrir-depuis-terminal.md) : un lien symbolique vers
# le script copié dans l'app, qui suit donc les mises à jour de l'app.
#
#   scripts/installer-cli.sh             dans ~/.local/bin
#   scripts/installer-cli.sh /opt/bin    dans un autre dossier
set -euo pipefail

# `EXPLORATEUR_APP` ne sert qu'à tester le script sur une autre copie de l'app.
APP="${EXPLORATEUR_APP:-/Applications/explorateur.app}"
TARGET="$APP/Contents/Resources/bin/explorateur"
DEST="${1:-$HOME/.local/bin}"

if [[ ! -x "$TARGET" ]]; then
  echo "explorateur n'est pas installée, ou trop ancienne : $TARGET est introuvable." >&2
  exit 1
fi

mkdir -p "$DEST"
ln -sf "$TARGET" "$DEST/explorateur"
echo "Commande installée : $DEST/explorateur"

case ":$PATH:" in
  *":$DEST:"*) ;;
  *)
    echo "$DEST n'est pas dans le PATH. Ajouter à ~/.zshrc :"
    echo "  export PATH=\"$DEST:\$PATH\""
    ;;
esac
