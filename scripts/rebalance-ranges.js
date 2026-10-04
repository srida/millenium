#!/usr/bin/env node
// Rééquilibrage PORTÉE / PV / VITESSE : la portée doit se PAYER.
//
// Mesuré avant ce script (simulation, catalogue livré) : à tier égal, une carte
// de portée 3 avait la même ATQ et autant de PV qu'une carte de mêlée, pour un
// tick d'attaque de plus — et survivait trois fois plus souvent au combat. Or
// les survivants infligent les dégâts de fin de round et gagnent la vétérance :
// la portée était un avantage gratuit, et le placement se résumait à « les
// tireurs derrière ».
//
// Le principe : la mêlée encaisse et va vite, la distance est FRAGILE et lente.
// Un tireur fragile est un tireur qu'il faut PROTÉGER — c'est-à-dire placer.
//
// Les cartes marquées `balance_excluded` (case de la fiche carte en admin) ne
// sont PAS retouchées.
//
// Le script applique un COEFFICIENT PAR PORTÉE, jamais une valeur cible : les
// écarts réglés à la main entre deux cartes de même portée sont conservés.
//
//   node scripts/rebalance-ranges.js                  # rapport, n'écrit rien
//   node scripts/rebalance-ranges.js --write          # applique à la cible
//   node scripts/rebalance-ranges.js --to=<dossier>   # écrit une COPIE du
//        catalogue modifié dans <dossier>, pour la mesurer avant de l'appliquer :
//        SIM_DATA_DIR=<dossier> npx vite-node src/sim/run.ts -- --games=20000
//   node scripts/rebalance-ranges.js --initial-data   # vise la SEMENCE du dépôt
//
// ⚠️ PAS IDEMPOTENT : un coefficient s'applique à ce qu'il trouve, le relancer
// l'appliquerait deux fois. Le passage est donc INSCRIT dans
// `<cible>/balance-history.json`, et le script refuse de rejouer un passage déjà
// inscrit. En prod : `npm run sync:pull` → ce script `--write` → `sync:push`
// (le registre reste local au dossier repris).
//
// ⚠️ Comme pour `migrate-speeds.js`, `data/` et `initial-data/` sont deux
// catalogues distincts : reprendre l'un ne reprend pas l'autre.
const fs = require('fs');
const path = require('path');

const PASS_ID = 'ranges-v1';

/**
 * Les coefficients, par classe de portée (4 = 4 et plus).
 *   hp / atk     — multiplicateurs, arrondis (PV au multiple de 5, ATQ à l'unité)
 *   move / atk_t — décalage de la période en TICKS (+ = plus lent), retraduit
 *                  en compteur 0–100 par l'échelle partagée.
 */
// Retenus après mesure (20 000 parties, 30 cartes exclues) : l'écart de
// victoires entre portées passe de 3,9 points (+0,1 → +4,0) à 1,0 (+0,6 → +1,6).
const DEFAULT_COEFFS = Object.freeze({
  1: { hp: 1.20, atk: 1.00, move: -2, atk_t: 0 },
  2: { hp: 0.95, atk: 1.00, move: 0, atk_t: 0 },
  3: { hp: 0.70, atk: 0.95, move: 2, atk_t: 1 },
  4: { hp: 0.85, atk: 1.00, move: 3, atk_t: 1 },
});

const PROJECT = path.join(__dirname, '..');
const arg = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const SOURCE = (!process.argv.includes('--initial-data')
  && fs.existsSync(path.join(PROJECT, 'data', 'cards.json')))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');
const TO = arg('to') ? path.resolve(arg('to')) : null;
const WRITE = process.argv.includes('--write');
// `--coeffs='{"3":{"hp":0.75}}'` surcharge une classe, pour itérer à la mesure.
const COEFFS = (() => {
  const over = arg('coeffs') ? JSON.parse(arg('coeffs')) : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_COEFFS)) out[k] = { ...DEFAULT_COEFFS[k], ...(over[k] || {}) };
  return out;
})();

function saveAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
  fs.renameSync(tmp, file);
}

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

async function main() {
  const { ticksForRate, rateForTicks, clampRate } = await import('../speed-scale.mjs');
  const shift = (rate, dTicks) => {
    if (!dTicks) return rate;
    const ticks = Math.min(77, Math.max(2, ticksForRate(clampRate(rate)) + dTicks));
    return rateForTicks(ticks);
  };

  const historyFile = path.join(TO ?? SOURCE, 'balance-history.json');
  const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
  if (!TO && history.some(h => h.id === PASS_ID)) {
    console.error(`[rebalance-ranges] le passage « ${PASS_ID} » est déjà inscrit dans ${historyFile} — refus de l'appliquer deux fois.`);
    process.exit(1);
  }

  const cards = JSON.parse(fs.readFileSync(path.join(SOURCE, 'cards.json'), 'utf8'));
  const tally = {};
  let skipped = 0;
  const out = cards.map(card => {
    const st = card.stats;
    // Une carte exclue de l'équilibrage (utilitaire) garde ses stats telles quelles.
    if (!st || card.balance_excluded) { if (card.balance_excluded) skipped++; return card; }
    const cls = Math.min(4, Math.max(1, Number(st.range) || 1));
    const k = COEFFS[cls];
    const next = {
      ...st,
      hp: round5(st.hp * k.hp),
      atk: Math.max(1, Math.round(st.atk * k.atk)),
      movement_rate: shift(st.movement_rate, k.move),
      attack_rate: shift(st.attack_rate, k.atk_t),
    };
    const t = (tally[cls] ??= { cards: 0, hpBefore: 0, hpAfter: 0, atkBefore: 0, atkAfter: 0 });
    t.cards++; t.hpBefore += st.hp; t.hpAfter += next.hp; t.atkBefore += st.atk; t.atkAfter += next.atk;
    return { ...card, stats: next };
  });

  console.log(`[rebalance-ranges] source : ${SOURCE} — ${skipped} carte(s) exclue(s) de l'équilibrage, laissée(s) telle(s) quelle(s)`);
  for (const [cls, t] of Object.entries(tally)) {
    console.log(`  portée ${cls}${cls === '4' ? '+' : ' '} : ${String(t.cards).padStart(4)} cartes · PV moy. ${(t.hpBefore / t.cards).toFixed(0)} → ${(t.hpAfter / t.cards).toFixed(0)} · ATQ moy. ${(t.atkBefore / t.cards).toFixed(1)} → ${(t.atkAfter / t.cards).toFixed(1)} · coeffs ${JSON.stringify(COEFFS[cls])}`);
  }

  const entry = { id: PASS_ID, date: new Date().toISOString(), coeffs: COEFFS };
  if (TO) {
    fs.mkdirSync(TO, { recursive: true });
    for (const f of fs.readdirSync(SOURCE)) {
      if (f.endsWith('.json') && f !== 'cards.json') fs.copyFileSync(path.join(SOURCE, f), path.join(TO, f));
    }
    saveAtomic(path.join(TO, 'cards.json'), out);
    saveAtomic(path.join(TO, 'balance-history.json'), [...history, entry]);
    console.log(`[rebalance-ranges] copie écrite dans ${TO}`);
  } else if (WRITE) {
    saveAtomic(path.join(SOURCE, 'cards.json'), out);
    saveAtomic(historyFile, [...history, entry]);
    console.log('[rebalance-ranges] appliqué.');
  } else {
    console.log('[rebalance-ranges] rapport seul (--write pour appliquer, --to=<dossier> pour mesurer une copie).');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
