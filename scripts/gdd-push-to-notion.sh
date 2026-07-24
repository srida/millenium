#!/usr/bin/env bash
# gdd-push-to-notion.sh
# Pousse une proposition de mise à jour GDD (fichier .md) comme nouvelle
# sous-page de la page Notion "Sync GDD", avec une mise en forme riche
# (titres, callouts, citations, listes) pour une meilleure lisibilité.
#
# Pré-requis :
#   - Créer une intégration interne sur https://www.notion.so/my-integrations
#   - Partager la page "Sync GDD" avec cette intégration (bouton "..." > Connexions)
#   - Renseigner NOTION_TOKEN et NOTION_SYNC_PAGE_ID (voir .env.example)
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <proposal-file.md>"
  exit 1
fi

PROPOSAL_FILE="$1"

if [ ! -f "$PROPOSAL_FILE" ]; then
  echo "Fichier introuvable : $PROPOSAL_FILE" >&2
  exit 1
fi

if [ -z "${NOTION_TOKEN:-}" ] || [ -z "${NOTION_SYNC_PAGE_ID:-}" ]; then
  echo "Erreur : variables NOTION_TOKEN et NOTION_SYNC_PAGE_ID requises." >&2
  echo "Voir .env.example pour la procédure de création de l'intégration Notion." >&2
  exit 1
fi

CONTENT=$(cat "$PROPOSAL_FILE")
FALLBACK_TITLE="$(basename "$PROPOSAL_FILE" .md)"

PAGE_PAYLOAD=$(python3 - "$CONTENT" "$FALLBACK_TITLE" "$NOTION_SYNC_PAGE_ID" <<'PYEOF'
import sys, json, re, textwrap

content, fallback_title, parent_id = sys.argv[1], sys.argv[2], sys.argv[3]
lines = content.split("\n")

INLINE_RE = re.compile(r'(\*\*.+?\*\*|`.+?`|\*.+?\*)')

def parse_inline(text):
    rich = []
    for token in INLINE_RE.split(text):
        if not token:
            continue
        if token.startswith("**") and token.endswith("**") and len(token) >= 4:
            rich.append(_text(token[2:-2], bold=True))
        elif token.startswith("`") and token.endswith("`") and len(token) >= 2:
            rich.append(_text(token[1:-1], code=True))
        elif token.startswith("*") and token.endswith("*") and len(token) >= 2:
            rich.append(_text(token[1:-1], italic=True))
        else:
            rich.append(_text(token))
    return rich or [_text(text)]

def _text(s, bold=False, italic=False, code=False):
    node = {"type": "text", "text": {"content": s[:1900]}}
    annotations = {}
    if bold:
        annotations["bold"] = True
    if italic:
        annotations["italic"] = True
    if code:
        annotations["code"] = True
    if annotations:
        node["annotations"] = annotations
    return node

def paragraph(text):
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": parse_inline(text)}}

def heading_2(text):
    return {"object": "block", "type": "heading_2",
            "heading_2": {"rich_text": parse_inline(text), "color": "blue"}}

def divider():
    return {"object": "block", "type": "divider", "divider": {}}

def bulleted(text):
    return {"object": "block", "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": parse_inline(text)}}

def callout(text, icon, color):
    return {"object": "block", "type": "callout",
            "callout": {"rich_text": parse_inline(text), "icon": {"type": "emoji", "emoji": icon}, "color": color}}

def quote(text, color="purple_background"):
    return {"object": "block", "type": "quote", "quote": {"rich_text": parse_inline(text), "color": color}}

title = None
date_value = None
blocks = []
i = 0
n = len(lines)

while i < n:
    raw = lines[i]
    s = raw.strip()

    if s.startswith("# ") and title is None:
        title = s[2:].strip()
        i += 1
        continue

    if s.startswith("Date :"):
        date_value = s[len("Date :"):].strip()
        i += 1
        continue

    if s == "Commits couverts :":
        blocks.append(callout("Commits couverts", "📦", "gray_background"))
        i += 1
        while i < n and lines[i].strip().startswith("- "):
            blocks.append(bulleted(lines[i].strip()[2:]))
            i += 1
        continue

    if s == "---":
        blocks.append(divider())
        i += 1
        continue

    if s.startswith("## "):
        blocks.append(heading_2(s[3:].strip()))
        i += 1
        continue

    if s.startswith("**Constat :**"):
        blocks.append(callout(s, "🔍", "gray_background"))
        i += 1
        continue

    if s.startswith("**Proposition de mise à jour :**"):
        blocks.append(callout(s, "💡", "blue_background"))
        i += 1
        continue

    if s.startswith(">"):
        quote_lines = []
        while i < n and lines[i].strip().startswith(">"):
            q = lines[i].strip()[1:].strip()
            if q.startswith("- "):
                q = "• " + q[2:]
            quote_lines.append(q)
            i += 1
        blocks.append(quote("\n".join(quote_lines)))
        continue

    if s == "":
        i += 1
        continue

    blocks.append(paragraph(s))
    i += 1

page_title = title or fallback_title
if date_value:
    page_title = f"{page_title} — {date_value}"

payload = {
    "parent": {"page_id": parent_id},
    "icon": {"type": "emoji", "emoji": "📐"},
    "properties": {
        "title": {"title": [{"type": "text", "text": {"content": page_title[:1900]}}]}
    },
    "children": blocks[:100]
}
print(json.dumps(payload))
PYEOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer ${NOTION_TOKEN}" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  --data "$PAGE_PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Erreur Notion (HTTP $HTTP_CODE) :" >&2
  echo "$BODY" | python3 -m json.tool >&2 2>/dev/null || echo "$BODY" >&2
  exit 1
fi

echo "✅ Proposition ajoutée comme sous-page de \"Sync GDD\"."
echo "   Relis-la dans Notion et intègre manuellement les parties validées dans ton GDD principal."
