#!/usr/bin/env bash
# install-hooks.sh
# A lancer une seule fois par repo pour activer la synchro GDD automatique.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ ! -d .githooks ]; then
  echo "Le dossier .githooks n'existe pas à la racine du repo." >&2
  echo "Copie d'abord le contenu de gdd-sync-kit/ à la racine de ton projet." >&2
  exit 1
fi

git config core.hooksPath .githooks
chmod +x .githooks/post-commit scripts/gdd-sync.sh scripts/gdd-push-to-notion.sh

echo "✅ Hooks installés (core.hooksPath = .githooks)."
echo "   Chaque commit déclenchera désormais scripts/gdd-sync.sh en arrière-plan."
