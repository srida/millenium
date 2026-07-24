#!/usr/bin/env node
/**
 * Liste les tickets Notion taggés "Code" et pas encore traités.
 *
 * Variables d'env requises :
 *   NOTION_API_KEY   -> clé de ton intégration interne Notion
 *   NOTION_DB_ID     -> ID de la data source (database) des tickets
 *
 * A ADAPTER selon ton schéma (voir README.md) :
 *   - TAG_PROPERTY / TAG_VALUE
 *   - STATUS_PROPERTY / STATUS_TODO_VALUE
 */

const NOTION_API_KEY = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_TASK_PAGE_ID;

// --- A ADAPTER ---
const TAG_PROPERTY = "Tags";         // nom de ta propriété multi-select / select
const TAG_VALUE = "Code";
const STATUS_PROPERTY = "Statut";    // nom de ta propriété statut
const STATUS_TODO_VALUE = "À faire"; // valeur correspondant à "pas encore pris en charge"
// ------------------

if (!NOTION_API_KEY || !NOTION_DB_ID) {
  console.error("Erreur: NOTION_API_KEY et NOTION_DB_ID doivent être définis.");
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

function extractPlainText(richTextArray = []) {
  return richTextArray.map((t) => t.plain_text).join("");
}

function extractTitle(properties) {
  for (const key of Object.keys(properties)) {
    if (properties[key].type === "title") {
      return extractPlainText(properties[key].title);
    }
  }
  return "(sans titre)";
}

function hasTag(properties, tagProp, tagValue) {
  const prop = properties[tagProp];
  if (!prop) return false;
  if (prop.type === "multi_select") {
    return prop.multi_select.some((t) => t.name === tagValue);
  }
  if (prop.type === "select") {
    return prop.select?.name === tagValue;
  }
  return false;
}

function getStatus(properties, statusProp) {
  const prop = properties[statusProp];
  if (!prop) return null;
  if (prop.type === "status") return prop.status?.name;
  if (prop.type === "select") return prop.select?.name;
  return null;
}

async function getPageContent(pageId) {
  const blocks = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const data = await notionFetch(`/blocks/${pageId}/children?${params}`);
    blocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return blocks
    .map((b) => {
      const rt = b[b.type]?.rich_text;
      return rt ? extractPlainText(rt) : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const data = await notionFetch(`/databases/${NOTION_DB_ID}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 50 }),
  });

  const tickets = [];
  for (const page of data.results) {
    if (!hasTag(page.properties, TAG_PROPERTY, TAG_VALUE)) continue;
    const status = getStatus(page.properties, STATUS_PROPERTY);
    if (STATUS_TODO_VALUE && status !== STATUS_TODO_VALUE) continue;

    const title = extractTitle(page.properties);
    const content = await getPageContent(page.id);
    tickets.push({
      id: page.id,
      url: page.url,
      title,
      status,
      content,
    });
  }

  console.log(JSON.stringify(tickets, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
