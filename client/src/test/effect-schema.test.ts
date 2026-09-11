/* eslint-disable @typescript-eslint/no-explicit-any */
// ÉTAPE 3 du moteur d'effets — le VOCABULAIRE et le compilateur se répondent.
//
// `effect-schema.mjs` (racine) déclare ce qu'un effet peut être : quel type, sur
// quel porteur, avec quels champs, à quel moment. `compile.ts` le traduit en
// tâches. Ce fichier est **le seul filet contre leur dérive** — même rôle que
// `tiers.js` ↔ `logic/Tiers.ts` ou `card-contract.js` ↔ `speed-scale.mjs`, et
// même raison : la frontière ESM-racine / TS-bundle interdit un module partagé.
//
// ⚠️ **Ce que ce fichier rend impossible.** `CLAUDE.md` le nommait :
// *« un effet d'attribut n'existe pour de bon qu'aux TROIS endroits à la fois :
// le moteur, le `<select>` de l'admin, et le libellé français. Deux sur trois
// donnent une fonctionnalité que personne ne peut ni écrire ni lire — c'est
// arrivé à `shopping_bonus`. »* Les quatre preuves ci-dessous ferment les quatre
// façons de n'en avoir que deux :
//
//   1. un type OFFERT que le moteur ne sait pas traduire (le `shopping_bonus`
//      d'origine, à l'envers) ;
//   2. un type UTILISÉ par le catalogue et absent de l'éditeur ;
//   3. un champ OFFERT que personne ne lit (`value_per` sur un bouclier,
//      `target` sur un `revive` — deux `<select>` décoratifs, trouvés par là) ;
//   4. un champ LU que l'éditeur ne propose pas — l'effet qu'on ne peut pas
//      écrire.
//
// ⚠️ Les preuves 3 et 4 passent par une **SONDE**, jamais par une table de noms
// recopiée : on change le champ, on regarde si la compilation bouge. C'est la
// discipline de `board-characterization.test.ts` — recopier la liste des champs
// lus reproduirait dans le test la décorrélation que le test surveille.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORTEURS, TYPES, STATS, TRIGGERS, QUAND_LABELS,
  typesPour, champsDe, libelleType, accepte, quandDe, effetNeuf,
} from '../../../effect-schema.mjs';
import { compileBoard, compileAttribute, compileMagie } from '../logic/effects/compile.js';
import { boardEffects } from '../logic/BoardEffect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lire = (f: string) => JSON.parse(readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));

const boards: any[] = lire('boards.json');
const attributs: any[] = lire('attributes.json');
const magies: any[] = lire('magies.json');
const pouvoirs: any[] = lire('powers.json');

const ATTR_IDS: ReadonlySet<string> = new Set(attributs.map(a => a.id));
/** Un attribut réel, pour les champs qui en exigent un (`value_per`, `attribute`). */
const UN_ATTRIBUT = attributs[0].id as string;
/**
 * Deux pouvoirs SANS durée : `grant_power` y chiffre sa `value`, pas sa
 * `duration`. ⚠️ Il en faut DEUX, pas un : la sonde change un champ et regarde
 * si la compilation bouge — avec une valeur constante elle prouve seulement que
 * réécrire la même chose ne change rien. (Elle a commencé comme ça, et elle a
 * signalé `power_id` non lu alors qu'il l'est parfaitement.)
 */
const SANS_DUREE = pouvoirs
  .filter((p: any) => !['POWER_PARALYSIS', 'POWER_BLOCK', 'POWER_CONFUSION', 'POWER_TAUNT'].includes(p.id))
  .map((p: any) => p.id as string);

// ───────────────────────────────────────────────────────────────────────────
// Le harnais : un porteur synthétique qui ne porte QUE l'effet examiné
// ───────────────────────────────────────────────────────────────────────────

/**
 * Une valeur recevable pour un champ, dérivée de sa `saisie`.
 *
 * ⚠️ Elle ne vient PAS de `effetNeuf` : les défauts de l'éditeur sont des
 * défauts de FORMULAIRE (`power_id: ''` attend un choix de l'auteur), et un
 * effet neuf n'a aucune raison de compiler tel quel. Ce qu'on éprouve ici est un
 * effet REMPLI.
 */
function valeurPour(champ: any, variante = 0): any {
  switch (champ.saisie) {
    // ⚠️ `choix_direct` : les options voyagent DANS le descripteur, parce
    // qu'elles dépendent du type (les moments qu'il sait honorer) et non d'un
    // catalogue. Sans ce cas, la sonde retombait sur le défaut NUMÉRIQUE et
    // écrivait `timing: 3` — un refus « moment inconnu » qui ressemblait à un
    // désaccord entre la table et le compilateur, alors que c'était le harnais.
    case 'choix_direct':
      // ⚠️ Une liste VIDE veut dire « ce champ n'a aucune valeur légale ici »
      // (le `timing` d'un `stat_modifier`, qui porte son moment dans son
      // `trigger`). Il n'y a rien à écrire, et surtout rien à sonder.
      if (!champ.options.length) return undefined;
      return champ.options[variante % champ.options.length][0];
    case 'choix':
      if (champ.options === 'stats') return (STATS as any)[variante % STATS.length][0];
      if (champ.options === 'triggers') return (TRIGGERS as any)[variante % TRIGGERS.length][0];
      if (champ.options === 'attributs') return variante ? (attributs[1].id as string) : UN_ATTRIBUT;
      if (champ.options === 'pouvoirs') return SANS_DUREE[variante % SANS_DUREE.length];
      if (champ.options === 'tiers') return 1 + (variante % 5);
      // ⚠️ `choix_direct` : les options voyagent dans le descripteur, parce
      // qu'elles dépendent du type (les moments qu'il sait honorer).
      return 'x';
    case 'criteres':
      return variante ? [attributs[1].id] : [UN_ATTRIBUT];
    case 'attributs_multi':
      return variante ? [attributs[1].id] : [UN_ATTRIBUT];
    default:
      // ⚠️ Jamais 0 ni 1 : `value` est lue en `||` par une poignée de types, où
      // un 0 vaut le DÉFAUT du champ. Une sonde à 0 rendrait donc la même
      // compilation qu'un champ absent et prouverait le contraire de ce qu'elle
      // croit prouver.
      return variante ? 7 : 3;
  }
}

/** Un effet rempli : tous ses champs déclarés, facultatifs compris. */
function effetRempli(porteur: string, type: string, variante = 0): any {
  const out: any = { type };
  for (const champ of champsDe(porteur, type)) {
    // ⚠️ `duration` et `value` s'excluent sur un `grant_power`, et c'est le
    // POUVOIR qui tranche : sur un pouvoir sans durée, écrire les deux ferait
    // du bruit que le moteur ne lit pas.
    if (type === 'grant_power' && champ.id === 'duration') continue;
    const v = valeurPour(champ, variante);
    if (v !== undefined) out[champ.id] = v;
  }
  return out;
}

/** Le porteur synthétique qui apporte cet effet, et rien d'autre. */
function compile(porteur: string, effet: any) {
  if (porteur === 'terrain') return compileBoard({ id: 'BOARD_T', effects: [effet] } as any);
  if (porteur === 'attribut') {
    // Le `timing` doit ACCORDER le porteur avec le type, sans quoi le
    // compilateur refuse nommément (`timing incohérent`) — c'est sa raison
    // d'être. Le schéma dit le `quand`, on en déduit le `timing` de la donnée.
    const quand = quandDe('attribut', effet.type, effet);
    const timing = quand === 'debut_combat' ? 'start_of_combat'
      : quand === 'fin_combat' ? 'end_of_combat' : 'during_combat';
    return compileAttribute({ id: 'ARCH_T', timing, thresholds: [{ count: 2, effects: [effet] }] } as any, ATTR_IDS);
  }
  return compileMagie({ id: 'MAGIE_T', effect: effet } as any);
}

const TYPES_MOTEUR = PORTEURS.flatMap((p: string) =>
  typesPour(p).filter((t: any) => t.moteur).map((t: any) => [p, t.id] as const));

const TOUS_LES_TYPES = PORTEURS.flatMap((p: string) =>
  typesPour(p).map((t: any) => [p, t.id] as const));

// ───────────────────────────────────────────────────────────────────────────

describe('effect-schema — ce que la table déclare, le compilateur le traduit', () => {
  it.each(TYPES_MOTEUR)('%s / %s compile sans un seul refus', (porteur, type) => {
    const { effets, refus } = compile(porteur, effetRempli(porteur, type));
    expect(refus).toEqual([]);
    expect(effets.length).toBeGreaterThan(0);
  });

  it.each(TYPES_MOTEUR)('%s / %s part au moment que la table annonce', (porteur, type) => {
    const effet = effetRempli(porteur, type);
    const { effets } = compile(porteur, effet);
    expect(effets[0].trigger.quand).toBe(quandDe(porteur, type, effet));
  });

  // ⚠️ L'AUTRE SENS — un type que le moteur traduit mais qu'aucun éditeur
  // n'offre est une fonctionnalité que personne ne peut écrire. C'est
  // exactement `shopping_bonus`, et il demande DEUX témoins, parce qu'aucun des
  // deux ne suffit :
  //
  //   • le CATALOGUE dit ce qui est écrit, mais il est muet sur un type que
  //     personne n'a encore utilisé — et `shopping_bonus` est précisément dans
  //     ce cas (0 attribut livré le porte). Retirer le type de la table laissait
  //     donc le test vert, mesuré. Même leçon qu'à la bascule des magies, où
  //     `shift_tier_card` était vert sans qu'aucune branche existe (§6.5).
  //   • les `case` du COMPILATEUR disent ce que le moteur sait faire, quoi
  //     qu'en dise la donnée. C'est le témoin qui manquait.
  it('tout type porté par le catalogue livré est déclaré pour son porteur', () => {
    const vus: [string, string][] = [];
    for (const b of boards) for (const e of boardEffects(b as any)) vus.push(['terrain', e.type as string]);
    for (const a of attributs) for (const s of a.thresholds ?? []) for (const e of s.effects ?? []) vus.push(['attribut', e.type]);
    for (const m of magies) if (m.effect?.type) vus.push(['magie', m.effect.type]);

    const manquants = [...new Set(vus.filter(([p, t]) => !accepte(p, t)).map(([p, t]) => `${p}/${t}`))];
    expect(manquants).toEqual([]);
  });

  it('tout type que le COMPILATEUR sait traduire est déclaré pour son porteur', () => {
    // ⚠️ On lit la SOURCE du compilateur, on ne recopie pas ses `case` dans une
    // liste. Une liste recopiée est une quatrième place à tenir d'accord — la
    // panne même que ce fichier ferme. Un `switch` n'étant pas introspectable,
    // la source est le seul témoin disponible, et il est exact.
    const src = readFileSync(path.join(ROOT, 'client/src/logic/effects/compile.ts'), 'utf8');
    const tranche = (debut: string, fin: string) =>
      src.slice(src.indexOf(debut), src.indexOf(fin));
    const casesDe = (texte: string) =>
      [...texte.matchAll(/^\s*case '([a-z_]+)':/gm)].map(m => m[1]);

    const parPorteur: Record<string, string[]> = {
      terrain: casesDe(tranche('export function compileBoard(', 'export function compileBoards(')),
      attribut: casesDe(tranche('export function compileAttribute(', 'export function compileAttributes(')),
      magie: casesDe(tranche('export function compileMagie(', 'export function compileMagies(')),
    };

    for (const [porteur, cas] of Object.entries(parPorteur)) {
      // Le garde-fou du garde-fou : une tranche vide passerait pour un accord.
      expect(cas.length, `aucun case trouvé pour ${porteur}`).toBeGreaterThan(3);
      const orphelins = [...new Set(cas.filter(t => !accepte(porteur, t)))];
      expect(orphelins, `${porteur} : traduits par le moteur, offerts nulle part`).toEqual([]);
    }
  });

  it('les deux effets hors moteur sont NOMMÉS, et ils sont exactement deux', () => {
    const hors = Object.entries(TYPES).filter(([, d]: any) => d.moteur === false);
    expect(hors.map(([id]) => id).sort()).toEqual(['defuse_fusion', 'draw_material']);
    // ⚠️ La frontière n'est pas un silence : chacun porte sa raison, et c'est
    // elle que l'admin affiche. Sans ça l'information ne vivrait que dans un
    // commentaire du compilateur, invisible de l'auteur du contenu.
    for (const [, def] of hors as any) expect(def.raison.length).toBeGreaterThan(40);

    // Et le compilateur les refuse bien, nommément.
    for (const [id] of hors) {
      const { refus } = compileMagie({ id: 'MAGIE_T', effect: { type: id } } as any);
      expect(refus).toHaveLength(1);
      expect(refus[0].raison).toBe('vocabulaire manquant');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Les deux sondes — un champ offert est un champ lu, et réciproquement
// ───────────────────────────────────────────────────────────────────────────

/** Tous les noms de champ que la table connaît, tous porteurs et types confondus. */
const TOUS_LES_CHAMPS = [...new Set(
  TOUS_LES_TYPES.flatMap(([p, t]) => champsDe(p, t).map((c: any) => c.id)),
)];

/** La compilation, réduite à ce qu'on peut comparer. */
const empreinte = (porteur: string, effet: any) => JSON.stringify(compile(porteur, effet));

describe('effect-schema — la sonde : un champ déclaré est un champ lu', () => {
  const sondables = TYPES_MOTEUR.flatMap(([p, t]) =>
    champsDe(p, t)
      // ⚠️ `session` est exclu, et c'est la frontière du §6.5 : `attribute` sur
      // une remise dit quelles cartes de la MAIN sont éligibles, une question
      // que `GameSession.magieHandTargets` pose et que le moteur ignore.
      .filter((c: any) => c.lecteur === 'moteur')
      // `duration` est exclu par le pouvoir choisi ci-dessus, pas par le schéma.
      .filter((c: any) => !(t === 'grant_power' && c.id === 'duration'))
      // ⚠️ Une sonde ne peut pas prouver qu'un champ est lu s'il n'a qu'UNE
      // valeur légale : les deux variantes écriraient la même chose. C'est le
      // cas de `timing` sur un type qui ne connaît qu'un moment — et ce qu'il
      // fait alors (refuser tout autre moment) est éprouvé par
      // `invocation-trigger.test.ts`, pas ici.
      .filter((c: any) => !(Array.isArray(c.options) && c.options.length < 2))
      .map((c: any) => [p, t, c.id] as const));

  it.each(sondables)('%s / %s : changer `%s` change la compilation', (porteur, type, champ) => {
    const avant = effetRempli(porteur, type, 0);
    const apres = { ...avant, [champ]: valeurPour(champsDe(porteur, type).find((c: any) => c.id === champ), 1) };
    expect(empreinte(porteur, apres)).not.toBe(empreinte(porteur, avant));
  });

  // ⚠️ Le cas particulier qui mérite d'être dit : `duration` N'EST lu que sur un
  // pouvoir qui en porte une. La sonde générique ne peut pas le voir (elle joue
  // un pouvoir sans durée), donc il a son cas à lui.
  it('grant_power : `duration` est lue quand le pouvoir en réclame une', () => {
    const base = { type: 'grant_power', power_id: 'POWER_PARALYSIS', power_rate: 50 };
    expect(empreinte('magie', { ...base, duration: 60 }))
      .not.toBe(empreinte('magie', { ...base, duration: 30 }));
  });
});

describe('effect-schema — la sonde inverse : un champ non déclaré n’est pas lu', () => {
  const parasites = TYPES_MOTEUR.flatMap(([p, t]) => {
    const declares = new Set(champsDe(p, t).map((c: any) => c.id));
    return TOUS_LES_CHAMPS.filter(c => !declares.has(c)).map(c => [p, t, c] as const);
  });

  it.each(parasites)('%s / %s : `%s` ne change rien (il n’est pas offert)', (porteur, type, champ) => {
    // ⚠️ La valeur injectée doit être PLAUSIBLE pour ce champ — un `stat: 42`
    // ne prouverait que l'évidence. On reprend donc le descripteur du champ là
    // où un autre couple (porteur, type) le déclare.
    const ailleurs = TOUS_LES_TYPES
      .map(([p2, t2]) => champsDe(p2, t2).find((c: any) => c.id === champ))
      .find(Boolean);
    const base = effetRempli(porteur, type, 0);
    const pollue = { ...base, [champ]: valeurPour(ailleurs, 1) };
    expect(empreinte(porteur, pollue)).toBe(empreinte(porteur, base));
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('effect-schema — la table elle-même', () => {
  it('chaque stat offerte est une stat que le compilateur sait traduire', () => {
    for (const [stat] of STATS as any) {
      const { refus } = compile('terrain', { type: 'stat_bonus', stat, value: 3, target_attributes: [] });
      expect(refus, `stat '${stat}'`).toEqual([]);
    }
  });

  it('chaque `quand` déclaré porte son libellé français', () => {
    for (const [porteur, type] of TOUS_LES_TYPES) {
      for (const q of (TYPES as any)[type][porteur].quands) {
        if (q === 'selon_trigger') continue;
        expect(QUAND_LABELS[q as keyof typeof QUAND_LABELS], `${porteur}/${type}`).toBeTruthy();
      }
    }
  });

  it('chaque type porte un libellé, et aucun ne retombe sur son slug', () => {
    for (const [, type] of TOUS_LES_TYPES) expect(libelleType(type)).not.toBe(type);
  });

  // ⚠️ L'effet neuf ne porte QUE ses champs obligatoires : c'est ce qui empêche
  // un `value: 0` parasite de se persister sur un type qui ne lit pas de valeur.
  // L'ancien formulaire de magie tenait ça à la main, dans DEUX listes `noValue`
  // qu'il fallait penser à mettre à jour ensemble.
  it('un effet neuf ne porte aucun champ que son type ne lit pas', () => {
    for (const [porteur, type] of TOUS_LES_TYPES) {
      const neuf = effetNeuf(porteur, type);
      const permis = new Set(['type', ...champsDe(porteur, type).map((c: any) => c.id)]);
      for (const k of Object.keys(neuf)) expect(permis.has(k), `${porteur}/${type} → ${k}`).toBe(true);
    }
  });

  it('`heal` ne porte AUCUN champ : le soin est total, `value` n’est pas lue', () => {
    expect(champsDe('magie', 'heal')).toEqual([]);
    expect(empreinte('magie', { type: 'heal', value: 10 })).toBe(empreinte('magie', { type: 'heal' }));
  });
});
