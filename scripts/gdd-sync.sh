#!/usr/bin/env bash
# gdd-sync.sh
# Analyse les commits depuis le dernier sync et génère une proposition
# de mise à jour du GDD via Claude Code (mode headless).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SYNC_MARKER=".gdd-last-sync"
PROPOSALS_DIR="gdd-proposals"
mkdir -p "$PROPOSALS_DIR"

CURRENT_COMMIT=$(git rev-parse HEAD)
CURRENT_SHORT=$(git rev-parse --short HEAD)

if [ -f "$SYNC_MARKER" ]; then
  LAST_COMMIT=$(cat "$SYNC_MARKER")
else
  # Premier lancement : on part du tout premier commit du repo
  LAST_COMMIT=$(git rev-list --max-parents=0 HEAD | tail -1)
fi

if [ "$LAST_COMMIT" = "$CURRENT_COMMIT" ]; then
  exit 0
fi

# Diff en excluant les fichiers générés par ce kit lui-même
DIFF=$(git diff "$LAST_COMMIT" "$CURRENT_COMMIT" -- . ":(exclude)$PROPOSALS_DIR" ":(exclude)$SYNC_MARKER" ":(exclude).gdd-sync.log")
LOG=$(git log --pretty=format:'- %s' "$LAST_COMMIT".."$CURRENT_COMMIT")

if [ -z "$DIFF" ]; then
  echo "$CURRENT_COMMIT" > "$SYNC_MARKER"
  exit 0
fi

PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" <<EOF
Tu es l'assistant de design d'un jeu vidéo. Voici les commits récents et leur
diff de code depuis la dernière synchronisation du GDD (Game Design Document).

Commits :
$LOG

Diff complet :
$DIFF

Consigne :
Analyse ce diff et identifie UNIQUEMENT les changements qui ont un impact sur
le game design (nouvelles mécaniques, équilibrage de valeurs de gameplay,
contenu jouable, systèmes de jeu, UX in-game). Ignore complètement le
refactoring pur, les changements de style/lint, les corrections de bugs sans
impact sur le design, et les changements purement techniques (build, CI,
dépendances).

Pour chaque changement pertinent, produis une entrée au format suivant :

## [Nom de la section du GDD concernée]
**Constat :** (ce qui a changé dans le code, en une phrase, factuel)
**Proposition de mise à jour :** (le texte prêt à copier-coller dans le GDD)

Si aucun changement n'a d'impact sur le design, réponds uniquement avec :
"Aucune mise à jour de GDD nécessaire pour ce commit."

Réponds uniquement avec le contenu décrit ci-dessus, sans préambule ni
conclusion, en français.
EOF

CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

set +e
PROPOSAL=$("$CLAUDE_BIN" --bare -p < "$PROMPT_FILE" --allowedTools "" --output-format text 2>/tmp/gdd-sync-error.log)
CLAUDE_EXIT=$?
set -e
rm -f "$PROMPT_FILE"

if [ $CLAUDE_EXIT -ne 0 ]; then
  echo "[gdd-sync] Erreur lors de l'appel à Claude Code, voir /tmp/gdd-sync-error.log" >&2
  exit 1
fi

if echo "$PROPOSAL" | grep -q "Aucune mise à jour"; then
  echo "$CURRENT_COMMIT" > "$SYNC_MARKER"
  echo "[gdd-sync] Pas d'impact design détecté pour le(s) commit(s) $LOG"
  exit 0
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PROPOSAL_FILE="$PROPOSALS_DIR/${TIMESTAMP}_${CURRENT_SHORT}.md"

cat > "$PROPOSAL_FILE" <<EOF
# Proposition de mise à jour GDD — commit $CURRENT_SHORT
Date : $(date '+%Y-%m-%d %H:%M')

Commits couverts :
$LOG

---

$PROPOSAL
EOF

echo "$CURRENT_COMMIT" > "$SYNC_MARKER"

echo ""
echo "📋 [gdd-sync] Proposition générée : $PROPOSAL_FILE"

if [ -n "${NOTION_TOKEN:-}" ] && [ -n "${NOTION_SYNC_PAGE_ID:-}" ]; then
  if "$REPO_ROOT/scripts/gdd-push-to-notion.sh" "$PROPOSAL_FILE"; then
    echo "    -> Poussée automatiquement vers Notion (sous-page de \"Sync GDD\")."
  else
    echo "    -> Échec du push automatique vers Notion. Relance manuellement :" >&2
    echo "       scripts/gdd-push-to-notion.sh \"$PROPOSAL_FILE\"" >&2
  fi
else
  echo "    -> NOTION_TOKEN / NOTION_SYNC_PAGE_ID absents, push manuel requis :"
  echo "       scripts/gdd-push-to-notion.sh \"$PROPOSAL_FILE\""
fi
echo ""
