#!/usr/bin/env node
// Reprise de données : les trois vitesses passent de la PÉRIODE EN TICKS au
// COMPTEUR 0–100 (`speed-scale.mjs`), où plus haut veut dire plus vite.
//
//   node scripts/migrate-speeds.js            # rapport, n'écrit rien
//   node scripts/migrate-speeds.js --write    # applique
//
// IDEMPOTENT : une entrée déjà migrée n'est pas touchée. Relancer le script
// deux fois ne change rien la seconde fois.
//
// Quatre catalogues, dans cet ordre :
//   1. `cards.json`     — `stats.attack_speed` / `stats.movement_speed` et
//                         `power.power_speed` deviennent leurs compteurs.
//   2. `magies.json`    — la STAT d'un effet est renommée, sa VALEUR retournée
//                         (un « −5 tick » devient un « +7 compteur »), et
//                         `grant_power.power_speed` devient `power_rate`.
//   3. `attributes.json`— idem, seuil par seuil.
//   4. `boards.json`    — idem, sur les deux formes (`effect` et `effects`).
//
// ⚠️ La conversion d'une valeur ABSOLUE est SANS PERTE : les horloges du combat
// sont entières et comparées en `>=`, donc `ticksForRate(rateForTicks(t)) === t`
// pour tout `t` de 2 à 77 (démontré dans `speed-scale.mjs`). Le jeu se joue au
// bit près comme avant la bascule — à la seule exception des pouvoirs au-delà
// de 77 ticks, qui n'ont pas d'équivalent sur une échelle bornée et sont
// ÉCRÊTÉS. Le rapport les nomme un par un ; c'est le plafonnement voulu.
//
// ⚠️ La conversion d'un DELTA, elle, ne peut pas être exacte (5 ticks valent
// 6,67 points) — l'écart est d'un quart de tick au pire, et il joue toujours
// en faveur du porteur du bonus.
//
// Cible : `data/` s'il existe (le volume, donc la prod), sinon `initial-data/`.
// En prod : `npm run sync:pull` → ce script → `npm run sync:push`.
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const DATA = fs.existsSync(path.join(PROJECT, 'data', 'cards.json'))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

const WRITE = process.argv.includes('--write');
const file = f => path.join(DATA, f);
const load = f => JSON.parse(fs.readFileSync(file(f), 'utf8'));

/** Écriture ATOMIQUE, comme `writeJson` côté serveur : l'hébergeur envoie un
 *  SIGTERM à chaque déploiement, et ce script peut tourner sur le volume. */
function save(f, value) {
  const tmp = `${file(f)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
  fs.renameSync(tmp, file(f));
}

async function main() {
  // ⚠️ `import()` et non `require` : l'échelle vit dans un module ESM pur, pour
  // être partagée telle quelle avec le bundle client et `admin.html`. La
  // recopier ici donnerait au catalogue une conversion et au jeu une autre —
  // et l'écart serait muet, un combat un peu plus lent ne ressemblant pas à
  // une panne.
  const {
    rateForTicks, ticksForRate, rateDeltaForTickDelta, TICKS_AT_MIN, LEGACY_TICK_FIELD,
  } = await import(path.join(PROJECT, 'speed-scale.mjs'));

  const report = { cards: 0, clamped: [], magies: 0, attributes: 0, boards: 0, refused: [] };

  // Le renommage d'un couple (champ de ticks → champ de compteur), sur l'objet
  // qui le porte. Rend `true` si quelque chose a bougé.
  const RENAMES = Object.entries(LEGACY_TICK_FIELD).map(([rate, ticks]) => ({ rate, ticks }));

  function convertAbsolute(holder, label) {
    let touched = false;
    for (const { rate, ticks } of RENAMES) {
      if (holder == null || !(ticks in holder)) continue;
      const t = holder[ticks];
      delete holder[ticks];
      if (rate in holder) { touched = true; continue; } // déjà migré : le vieux champ n'était qu'un résidu
      holder[rate] = rateForTicks(t);
      // ⚠️ On ne signale QUE l'écrêtage réel — un aller-retour qui retombe sur
      // sa valeur n'apprend rien, et noyer les six vrais cas dans 868 lignes
      // reviendrait à ne pas les signaler du tout.
      if (Number.isFinite(Number(t)) && ticksForRate(holder[rate]) !== Number(t)) {
        report.clamped.push(`${label} : ${ticks} ${t} → ${rate} ${holder[rate]} (${ticksForRate(holder[rate])} ticks au lieu de ${t})`);
      }
      touched = true;
    }
    return touched;
  }

  /**
   * Un effet (de magie, d'attribut ou de terrain) qui vise un rythme.
   *
   * ⚠️ `stat_bonus` porte un DELTA (converti), `stat_modifier` porte selon son
   * hôte soit un delta — la forme `during_combat` d'un attribut, que
   * `Unit.applyStatModifier` additionne — soit un MULTIPLICATEUR, chez les
   * magies et les terrains. Un multiplicateur de PÉRIODE n'a aucun équivalent
   * sur une échelle de compteur : « ×2 » y vaut −19 points sur une unité rapide
   * et −51 sur une lente. On REFUSE plutôt que d'inventer, et le rapport le
   * nomme — c'est exactement le genre de conversion qu'un repli silencieux
   * rendrait fausse sans que personne ne le voie.
   */
  function convertEffect(effect, label, { modifierIsDelta }) {
    if (!effect || typeof effect !== 'object') return false;
    let touched = false;
    if ('power_speed' in effect) {
      const t = effect.power_speed;
      delete effect.power_speed;
      if (!('power_rate' in effect)) effect.power_rate = rateForTicks(t);
      touched = true;
    }
    for (const { rate, ticks } of RENAMES) {
      if (effect.stat !== ticks) continue;
      const isDelta = effect.type === 'stat_bonus' || modifierIsDelta;
      if (!isDelta) {
        report.refused.push(`${label} : \`stat_modifier\` ×${effect.value} sur ${ticks} — un multiplicateur de période n'a pas d'équivalent en compteur, à reprendre à la main.`);
        return touched;
      }
      effect.stat = rate;
      effect.value = rateDeltaForTickDelta(effect.value);
      touched = true;
    }
    return touched;
  }

  // ---------------------------------------------------------------- 1. cartes
  const cards = load('cards.json');
  if (!Array.isArray(cards)) { console.error('cards.json : tableau attendu.'); process.exit(1); }
  for (const c of cards) {
    const label = `${c.id} (« ${c.name} »)`;
    let touched = convertAbsolute(c.stats, label);
    if (c.power) touched = convertAbsolute(c.power, `${label} — pouvoir`) || touched;
    if (touched) report.cards++;
  }

  // ---------------------------------------------------------------- 2. magies
  const magies = load('magies.json');
  for (const m of magies) {
    // Une magie porte UN effet, et son `stat_modifier` est un multiplicateur.
    if (convertEffect(m.effect, `${m.id} (« ${m.name} »)`, { modifierIsDelta: false })) report.magies++;
  }

  // ------------------------------------------------------------ 3. attributs
  const attributes = load('attributes.json');
  for (const a of attributes) {
    // ⚠️ Chez un attribut, `stat_modifier` est un DELTA additif : c'est
    // `Unit.applyStatModifier` qui le consomme, et il additionne. Le type porte
    // donc deux sens selon son hôte — d'où le drapeau plutôt qu'une règle
    // écrite sur le seul nom du type.
    const modifierIsDelta = true;
    let touched = false;
    const visit = eff => {
      for (const e of [].concat(eff ?? [])) {
        if (e?.thresholds) { for (const t of e.thresholds) visit(t.effects); continue; }
        touched = convertEffect(e, `${a.id} (« ${a.name} »)`, { modifierIsDelta }) || touched;
      }
    };
    visit(a.effects); visit(a.effect);
    for (const t of a.thresholds ?? []) visit(t.effects);
    if (touched) report.attributes++;
  }

  // ------------------------------------------------------------- 4. terrains
  const boards = load('boards.json');
  for (const b of boards) {
    // Sur un terrain, `stat_modifier` est un multiplicateur (`BoardEffect` le
    // convertit en additif via `_base[stat] × (value − 1)`).
    let touched = false;
    for (const e of [].concat(b.effects ?? [], b.effect ? [b.effect] : [])) {
      touched = convertEffect(e, `${b.id} (« ${b.name} »)`, { modifierIsDelta: false }) || touched;
    }
    if (touched) report.boards++;
  }

  // ----------------------------------------------------------------- rapport
  console.log(`Catalogue : ${DATA}`);
  console.log(`  cartes migrées      : ${report.cards}`);
  console.log(`  magies migrées      : ${report.magies}`);
  console.log(`  attributs migrés    : ${report.attributes}`);
  console.log(`  terrains migrés     : ${report.boards}`);
  if (report.clamped.length) {
    console.log(`\n⚠️  ${report.clamped.length} valeur(s) ÉCRÊTÉE(S) — au-delà de ${TICKS_AT_MIN} ticks, l'échelle n'a pas d'équivalent :`);
    for (const line of report.clamped) console.log(`     ${line}`);
  }
  if (report.refused.length) {
    console.log(`\n✗  ${report.refused.length} effet(s) NON convertis :`);
    for (const line of report.refused) console.log(`     ${line}`);
  }

  if (!WRITE) {
    console.log('\n(rapport seul — relancer avec --write pour appliquer)');
    return;
  }
  save('cards.json', cards);
  save('magies.json', magies);
  save('attributes.json', attributes);
  save('boards.json', boards);
  console.log('\n✓ écrit.');
}

main().catch(err => { console.error(err); process.exit(1); });
