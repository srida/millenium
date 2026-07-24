#!/usr/bin/env node
/**
 * Met à jour un ticket Notion après traitement par Claude Code :
 * ajoute un commentaire et change le statut.
 *
 * Usage :
 *   node update-ticket.mjs <page_id> "<commentaire markdown simple>" "<nouveau statut>"
 *
 * Variables d'env requises :
 *   NOTION_API_KEY
 *
 * A ADAPTER selon ton schéma :
 *   - STATUS_PROPERTY (doit matcher list-code-tickets.mjs)
 */

const NOTION_API_KEY = process.env.NOTION_TOKEN;
const STATUS_PROPERTY = "Statut"; // A ADAPTER

const [pageId, comment, newStatus] = process.argv.slice(2);

if (!NOTION_API_KEY) {
  console.error("Erreur: NOTION_API_KEY doit être défini.");
  process.exit(1);
}
if (!pageId || !comment) {
  console.error('Usage: node update-ticket.mjs <page_id> "<commentaire>" ["<statut>"]');
  process.exit(1);
}

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }
  return res.json();
}

async function addComment(pageId, text) {
  await notionFetch(`/comments`, {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: pageId },
      rich_text: [{ type: "text", text: { content: text } }],
    }),
  });
}

async function updateStatus(pageId, statusName) {
  // Récupère d'abord la page pour connaître le type de la propriété statut
  const page = await notionFetch(`/pages/${pageId}`);
  const propType = page.properties[STATUS_PROPERTY]?.type;

  const value =
    propType === "status"
      ? { status: { name: statusName } }
      : { select: { name: statusName } };

  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { [STATUS_PROPERTY]: value },
    }),
  });
}

async function main() {
  await addComment(pageId, comment);
  if (newStatus) {
    await updateStatus(pageId, newStatus);
  }
  console.log(`Ticket ${pageId} mis à jour.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
