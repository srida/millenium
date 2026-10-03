#!/usr/bin/env node
// Reprise de données : Attaque Zone et Provocation reçoivent une ZONE
// (`power.zone`, un rayon de Manhattan — cf. `speed-scale.mjs`).
//
// Avant, ces deux pouvoirs agissaient sur TOUT le plateau. La zone les rend
// locaux, donc le placement compte. Valeurs posées :
//   • Attaque Zone : zone 1 aux tiers 1–3, zone 2 aux tiers 4–5 (tier = le plus
//     haut de la carte) ;
//   • Provocation  : zone 2.
// Ce sont des valeurs DE DÉPART, à retoucher en admin carte par carte.
//
//   node scripts/migrate-zones.js                    # rapport, n'écrit rien
//   node scripts/migrate-zones.js --write            # applique
//   node scripts/migrate-zones.js --initial-data     # vise la SEMENCE du dépôt
//
// IDEMPOTENT : une zone déjà posée n'est jamais touchée.
//
// Trois catalogues : `cards.json`, `tokens.json` (un token porte un pouvoir
// comme une carte) et `magies.json` (`grant_power` donne un pouvoir, donc sa
// zone avec).
//
// ⚠️ Comme pour `migrate-speeds.js`, les DEUX dossiers sont à reprendre :
// `bootstrap()` ne recopie jamais `initial-data/` sur un `data/` déjà peuplé.
const fs = require('fs');
const path = require('path');
const { tierIndex, resolveTiers } = require('../tiers');

const PROJECT = path.join(__dirname, '..');
const DATA = (!process.argv.includes('--initial-data')
  && fs.existsSync(path.join(PROJECT, 'data', 'cards.json')))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const WRITE = process.argv.includes('--write');
const file = f => path.join(DATA, f);
const exists = f => fs.existsSync(file(f));
const load = f => JSON.parse(fs.readFileSync(file(f), 'utf8'));

/** Écriture ATOMIQUE, comme `writeJson` côté serveur. */
function save(f, value) {
  const tmp = `${file(f)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
  fs.renameSync(tmp, file(f));
}

/** La zone de départ d'un pouvoir, selon le tier le plus haut du porteur. */
function initialZone(powerId, tier) {
  if (powerId === 'POWER_AOE_ATTACK') return tier >= 4 ? 2 : 1;
  if (powerId === 'POWER_TAUNT') return 2;
  return null;
}

async function main() {
  const { ZONE_POWERS } = await import('../speed-scale.mjs');
  const tiers = tierIndex(exists('attributes.json') ? load('attributes.json') : []);
  const report = [];

  // Cartes et tokens : le pouvoir vit dans `power`.
  for (const f of ['cards.json', 'tokens.json']) {
    if (!exists(f)) continue;
    const list = load(f);
    let changed = 0;
    const out = list.map(entry => {
      const p = entry.power;
      if (!p || !ZONE_POWERS.includes(p.id) || (p.zone != null && p.zone !== '')) return entry;
      const ts = resolveTiers(entry, tiers);
      const zone = initialZone(p.id, ts.length ? ts[ts.length - 1] : 1);
      changed++;
      report.push(`${f} ${entry.id} (${p.id}) → zone ${zone}`);
      return { ...entry, power: { ...p, zone } };
    });
    if (WRITE && changed) save(f, out);
  }

  // Magies : `grant_power` porte le pouvoir à plat dans `effect`.
  if (exists('magies.json')) {
    const list = load('magies.json');
    let changed = 0;
    const out = list.map(m => {
      const e = m.effect;
      if (e?.type !== 'grant_power' || !ZONE_POWERS.includes(e.power_id)) return m;
      if (e.zone != null && e.zone !== '') return m;
      const zone = initialZone(e.power_id, 1);
      changed++;
      report.push(`magies.json ${m.id} (grant_power ${e.power_id}) → zone ${zone}`);
      return { ...m, effect: { ...e, zone } };
    });
    if (WRITE && changed) save('magies.json', out);
  }

  console.log(`[migrate-zones] ${DATA}`);
  for (const line of report) console.log(`  ${line}`);
  console.log(`[migrate-zones] ${report.length} entrée(s) ${WRITE ? 'reprise(s)' : 'à reprendre (--write pour appliquer)'}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
