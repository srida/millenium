/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les types Node sont référencés ICI et pas dans `types` du tsconfig : le client
// est du code navigateur, seuls ces tests (qui chargent un module serveur) en ont
// besoin.
//
// Golden tests des RÉCOMPENSES DE PALIER DE NIVEAU (levels.js, côté SERVEUR) et
// de leur branchement dans `progression.grant` — le seul passage obligé de l'XP.
//
// Même harnais que gifts.test.ts / shop.test.ts : le module est chargé via
// createRequire avec un DATA_DIR temporaire, il ouvre sa propre base SQLite et
// ne touche jamais data/soulforge.db. Le fichier écrit son PROPRE `sets.json`
// (la prime de complétion d'un pack fait partie du sujet) et de vrais PNG dans
// un ILLUS_DIR temporaire — sans art, le pool de cartes serait vide et la
// moitié du fichier ne prouverait plus rien.
//
// Ce qui est verrouillé ici :
//   - le barème : 50 golds par niveau, 50 gemmes tous les 5, un objet tous les 10 ;
//   - un gain d'XP qui franchit PLUSIEURS paliers les verse TOUS ;
//   - le tirage ne sort que des familles qui ont encore quelque chose à donner,
//     jamais une carte sans illustration, et il est reproductible ;
//   - une carte tirée a exactement les conséquences d'une carte achetée
//     (collection, épingle, prime de complétion) ;
//   - un pool entièrement épuisé ne fait pas perdre les monnaies du palier ;
//   - un niveau posé d'autorité (admin) ne verse rien.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let levels: any;
let progression: any;
let shop: any;
let cosmetics: any;
let stmt: any;
let CARDS: any[];
let TMP: string;
let ILLUS: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const putArt = (id: string) => fs.writeFileSync(path.join(ILLUS, `${id}.png`), PNG);

// Les caches de sets.js / variants.js s'invalident au mtime, et deux écritures
// consécutives tombent facilement dans la MÊME milliseconde : le mtime est forcé
// à une valeur strictement croissante. Même précaution que packs.test.ts.
let writes = 0;
function writeJson(name: string, value: unknown) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, JSON.stringify(value, null, '\t'), 'utf8');
  const stamp = new Date(Date.now() + ++writes * 60_000);
  fs.utimesSync(file, stamp, stamp);
}

// Une carte volontairement SANS illustration : elle ne doit jamais tomber au
// palier, exactement comme elle ne se vend pas en boutique.
let NO_ART: string;

let _tagSeq = 0;

/** Compte neuf, doté comme à l'inscription. */
function newUser() {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return () => stmt.userById.get(id);
}

/** Amène le compte au niveau `target` — en un seul gain, comme le ferait une XP massive. */
function levelTo(userId: string, target: number) {
  const current = stmt.userById.get(userId).level;
  return progression.grant(userId, { xp: (target - current) * 100 });
}

/** Vide le pool de CARTES : tout ce qui a un art entre dans la collection. */
function ownEveryCard(userId: string) {
  progression.unlockCards(userId, shop.sellableCards().map((c: any) => c.id));
}

/** Vide le pool d'AVATARS (le plus large : tout ce qui a une illustration). */
function ownEveryAvatar(userId: string) {
  for (const a of cosmetics.avatarPool()) cosmetics.unlock(userId, 'avatar', a.id);
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-levels-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-levels-illus-'));
  // Catalogues lus depuis `initial-data/` — versionné, donc toujours présent,
  // là où `data/` n'est créé qu'au premier démarrage du serveur (précédent :
  // tutorial.test.ts). `sets.json` et `variants.json` sont écrits ici même :
  // c'est le catalogue qui est l'objet du test.
  for (const f of ['cards.json', 'missions.json', 'boards.json', 'magies.json']) {
    fs.copyFileSync(path.join(ROOT, 'initial-data', f), path.join(TMP, f));
  }
  process.env.DATA_DIR = TMP;
  process.env.ILLUS_DIR = ILLUS;

  CARDS = JSON.parse(fs.readFileSync(path.join(TMP, 'cards.json'), 'utf8'));
  // Catalogue entièrement illustré SAUF une carte : c'est l'état nominal, et
  // l'exception est le sujet d'un test.
  NO_ART = CARDS[CARDS.length - 1].id;
  for (const c of CARDS) if (c.id !== NO_ART) putArt(c.id);

  writeJson('sets.json', []);
  writeJson('variants.json', []);

  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  shop = require(path.join(ROOT, 'shop.js'));
  cosmetics = require(path.join(ROOT, 'cosmetics.js'));
  levels = require(path.join(ROOT, 'levels.js'));
});

describe('barème', () => {
  it('50 golds à CHAQUE niveau', () => {
    for (const level of [2, 3, 7, 11, 42]) {
      expect(levels.rewardsForLevel(level).gold).toBe(50);
    }
    expect(levels.GOLD_PER_LEVEL).toBe(50);
  });

  it('50 gemmes tous les 5 niveaux, et seulement là', () => {
    expect(levels.rewardsForLevel(5).gems).toBe(50);
    expect(levels.rewardsForLevel(10).gems).toBe(50);
    expect(levels.rewardsForLevel(20).gems).toBe(50);
    for (const level of [2, 3, 4, 6, 9, 11]) expect(levels.rewardsForLevel(level).gems).toBe(0);
  });

  it('un objet tous les 10 niveaux, et seulement là', () => {
    expect(levels.rewardsForLevel(10).draw).toBe(true);
    expect(levels.rewardsForLevel(20).draw).toBe(true);
    for (const level of [2, 5, 9, 15, 19]) expect(levels.rewardsForLevel(level).draw).toBe(false);
  });

  it('les trois marches se cumulent : le palier 10 donne les trois', () => {
    // C'est ce cumul qui fait du multiple de 10 un rendez-vous et non un
    // remplacement — le joueur ne perd ni ses golds ni ses gemmes ce jour-là.
    expect(levels.rewardsForLevel(10)).toEqual({ level: 10, gold: 50, gems: 50, draw: true });
  });
});

describe('dette de paliers', () => {
  it('monter de niveau ne crédite rien — le palier ATTEND', () => {
    // C'est toute la différence avec un versement automatique : le gain existe,
    // mais il ne bouge pas tant que le joueur ne l'a pas pris.
    const user = newUser();
    const res = progression.grant(user().id, { xp: 100 });

    expect(res.level).toBe(2);
    expect(res.gold).toBe(0);
    expect(res.gems).toBe(0);
    expect(res.pending_levels).toBe(1);
  });

  it('un gain d\'XP qui ne franchit aucun palier n\'ouvre aucune dette', () => {
    const user = newUser();
    const res = progression.grant(user().id, { xp: 50 });
    expect(res.level).toBe(1);
    expect(res.pending_levels).toBe(0);
    expect(levels.claim(user())).toMatchObject({ ok: false });
  });

  it('la dette s\'accumule sur plusieurs niveaux et survit aux gains suivants', () => {
    // Un joueur qui enchaîne les parties sans passer au Profil ne doit rien
    // perdre : rien ne périme un palier, il n'y a aucune rotation ici.
    const user = newUser();
    progression.grant(user().id, { xp: 250 });
    expect(progression.getProgression(user()).pending_levels).toBe(2);

    progression.grant(user().id, { xp: 100 });
    expect(progression.getProgression(user()).pending_levels).toBe(3);
    expect(progression.getProgression(user()).gold).toBe(0);
  });

  it('un compte neuf n\'a aucune dette', () => {
    expect(progression.getProgression(newUser()()).pending_levels).toBe(0);
  });

  it('un niveau posé d\'autorité (admin) n\'ouvre aucun palier', () => {
    // `applyAdminGrants` écrit level: 100 : sans l'alignement de
    // `levels_claimed`, l'admin ouvrirait l'écran sur 99 paliers rétroactifs.
    const user = newUser();
    const res = progression.applyAdminGrants(user().id);
    expect(res.level).toBe(100);
    expect(res.pending_levels).toBe(0);
    expect(levels.claim(user())).toMatchObject({ ok: false });
  });

  it('retirer de l\'XP ne fait ni redescendre ni ouvrir de palier', () => {
    const user = newUser();
    levelTo(user().id, 4);
    levels.claim(user());

    const res = progression.grant(user().id, { xp: -500 });
    expect(res.level).toBe(4);
    expect(res.pending_levels).toBe(0);
  });
});

describe('récupération', () => {
  it('verse 50 golds par palier, d\'un seul geste', () => {
    const user = newUser();
    levelTo(user().id, 4);

    const res = levels.claim(user());
    expect(res.ok).toBe(true);
    expect(res.lines.map((l: any) => l.level)).toEqual([2, 3, 4]);
    expect(res.granted).toEqual({ gold: 150, gems: 0 });
    expect(progression.getProgression(user()).gold).toBe(150);
    expect(progression.getProgression(user()).pending_levels).toBe(0);
  });

  it('n\'oublie aucun palier traversé, gemmes comprises', () => {
    // 10 paliers (2→11) : 10 × 50 golds, et les niveaux 5 et 10 pour les gemmes.
    // Sauter un intermédiaire dépouillerait le joueur qui joue rarement mais
    // longtemps.
    const user = newUser();
    levelTo(user().id, 11);

    const res = levels.claim(user());
    expect(res.lines).toHaveLength(10);
    expect(res.granted).toEqual({ gold: 500, gems: 100 });
  });

  it('un second tap ne crédite rien', () => {
    const user = newUser();
    levelTo(user().id, 3);
    expect(levels.claim(user()).ok).toBe(true);
    const after = progression.getProgression(user());

    expect(levels.claim(user())).toMatchObject({ ok: false });
    expect(progression.getProgression(user()).gold).toBe(after.gold);
  });

  it('la garde est dans le SQL, pas dans une relecture JS', () => {
    // On solde la dette à la main, sans passer par levels.js : la récupération
    // doit échouer quand même. C'est ce qui garantit que deux taps concurrents
    // ne créditent qu'une fois.
    const user = newUser();
    levelTo(user().id, 5);
    stmt.claimLevels.run({ id: user().id, from: 1, level: 5 });

    const before = progression.getProgression(user());
    expect(levels.claim(user()).ok).toBe(false);
    expect(progression.getProgression(user()).gold).toBe(before.gold);
  });

  it('un niveau gagné entre deux taps reste dû', () => {
    const user = newUser();
    levelTo(user().id, 3);
    expect(levels.claim(user()).granted).toEqual({ gold: 100, gems: 0 });

    levelTo(user().id, 5);
    expect(progression.getProgression(user()).pending_levels).toBe(2);
    const res = levels.claim(user());
    expect(res.lines.map((l: any) => l.level)).toEqual([4, 5]);
    expect(res.granted).toEqual({ gold: 100, gems: 50 });
  });

  it('récupère à partir d\'une session périmée — le niveau est relu en base', () => {
    // `user` vient de la session : son niveau peut dater d'avant la partie qui
    // vient de se terminer. Le serveur ne doit jamais se fier à cette copie.
    const user = newUser();
    const stale = user();
    levelTo(user().id, 3);

    const res = levels.claim(stale);
    expect(res.ok).toBe(true);
    expect(res.lines.map((l: any) => l.level)).toEqual([2, 3]);
  });
});

describe('tirage du palier 10', () => {
  it('livre un objet réellement acquis, et le nomme', () => {
    const user = newUser();
    levelTo(user().id, 10);
    const res = levels.claim(user());

    const line = res.lines.find((l: any) => l.level === 10);
    expect(line.item).toBeTruthy();
    expect(['card', 'avatar', 'variant']).toContain(line.item.type);
    // Le libellé voyage avec l'objet : le client annonce un nom, pas un id.
    expect(line.item.label).toBeTruthy();

    const fresh = user();
    const acquired = line.item.type === 'card'
      ? progression.ownsCard(fresh, line.item.id)
      : cosmetics.owns(fresh.id, line.item.type, line.item.id);
    expect(acquired).toBe(true);
  });

  it('ne tire que dans les familles qui ont encore quelque chose à donner', () => {
    // Aucune variante au catalogue : un compte neuf n'a donc que deux familles
    // possibles. Sans le filtre, un palier sur trois ne donnerait rien.
    const user = newUser();
    levelTo(user().id, 10);
    const res = levels.claim(user());
    expect(res.lines.find((l: any) => l.level === 10).item.type).not.toBe('variant');
  });

  it('ne tire jamais une carte sans illustration', () => {
    // Le compte possède toutes les cartes VENDABLES : la seule carte qui reste
    // au catalogue est celle sans art. Le pool de cartes est donc vide, et le
    // tirage doit se rabattre sur une autre famille plutôt que la sortir.
    const user = newUser();
    ownEveryCard(user().id);
    expect(levels.pools(user()).card).toHaveLength(0);

    levelTo(user().id, 10);
    const item = levels.claim(user()).lines.find((l: any) => l.level === 10).item;
    expect(item.type).not.toBe('card');
    expect(progression.ownsCard(user(), NO_ART)).toBe(false);
  });

  it('est reproductible à (joueur, niveau) — un tirage douteux se rejoue', () => {
    const user = newUser();
    levelTo(user().id, 10);

    // Le tirage attendu est recalculé AVANT le tap, sur l'état exact que
    // `drawItem` verra : la seed est (id, 'level', niveau), rien d'autre.
    const rand = shop.seededRandom(user().id, 'level', 10);
    const available = levels.pools(user());
    const kinds = levels.DRAW_KINDS.filter((k: string) => available[k].length);
    const expectedKind = shop.pick(kinds, rand);
    const expectedItem = shop.pick(available[expectedKind], rand);

    const item = levels.claim(user()).lines.find((l: any) => l.level === 10).item;
    expect(item.type).toBe(expectedKind);
    expect(item.id).toBe(expectedItem.id);
  });

  it('deux paliers d\'objet dans le même gain ne donnent pas deux fois la même chose', () => {
    // Le tirage lit la collection : il doit avoir lieu palier par palier, pas
    // une fois pour toutes sur l'état de départ.
    //
    // ⚠️ La comparaison porte sur (famille, id) et non sur l'id seul : cartes,
    // terrains, magies et variantes partagent l'espace de noms plat du dossier
    // d'illustrations, et l'avatar `CORE_050` n'est pas la carte `CORE_050` —
    // les deux peuvent légitimement tomber au même joueur.
    const user = newUser();
    levelTo(user().id, 20);
    const res = levels.claim(user());

    const items = res.lines.filter((l: any) => l.item).map((l: any) => l.item);
    expect(items).toHaveLength(2);
    expect(`${items[0].type}:${items[0].id}`).not.toBe(`${items[1].type}:${items[1].id}`);
  });

  it('une carte tirée entre dans la collection et paie la prime de complétion du pack qu\'elle termine', () => {
    // Une carte OFFERTE qui termine un pack doit payer sa prime — sinon elle
    // attend la prochaine visite en boutique, c'est-à-dire jamais pour qui
    // n'achète plus. C'est `shop.settleCollection` qui le garantit, et ce test
    // vérifie qu'il est bien appelé.
    // Hors dotation de départ (`CORE_*`) : une carte déjà offerte à
    // l'inscription ne peut pas manquer à la collection du compte de test.
    const packCards = CARDS.filter(c => c.id !== NO_ART && !String(c.id).startsWith('CORE_')).slice(0, 2);
    writeJson('sets.json', [{
      id: 'PACK_LEVEL', name: 'Pack test', cards: packCards.map(c => c.id),
      booster_enabled: true, completion_reward: { gems: 300 },
    }]);

    // Le compte possède TOUT sauf la première carte du pack, avatars compris :
    // le tirage n'a plus qu'un candidat, la famille est donc forcée sans avoir
    // à truquer le hasard.
    const target = packCards[0].id;
    const other = newUser();
    progression.unlockCards(
      other().id,
      shop.sellableCards().map((c: any) => c.id).filter((id: string) => id !== target),
    );
    ownEveryAvatar(other().id);
    expect(levels.pools(other()).card.map((c: any) => c.id)).toEqual([target]);

    levelTo(other().id, 10);
    const line = levels.claim(other()).lines.find((l: any) => l.level === 10);
    expect(line.item.type).toBe('card');
    expect(line.item.id).toBe(target);
    expect(progression.ownsCard(other(), target)).toBe(true);
    // La prime du pack (300 gemmes) s'ajoute aux gemmes des paliers traversés
    // (niveaux 5 et 10) : c'est bien un gain de plus, pas un remplacement.
    expect(line.item.sets_completed.map((s: any) => s.set_id)).toContain('PACK_LEVEL');
    expect(progression.getProgression(other()).gems).toBe(100 + 300);

    writeJson('sets.json', []);
  });

  it('un pool entièrement épuisé ne fait pas perdre les monnaies du palier', () => {
    // Aucune compensation n'est inventée : le palier verse ses golds et ses
    // gemmes, et dit qu'il n'y avait rien à tirer.
    const user = newUser();
    ownEveryCard(user().id);
    ownEveryAvatar(user().id);
    const before = progression.getProgression(user());

    levelTo(user().id, 10);
    const res = levels.claim(user());
    expect(res.lines.find((l: any) => l.level === 10).item).toBeNull();
    expect(res.granted).toEqual({ gold: 9 * 50, gems: 100 });
    expect(progression.getProgression(user()).gold).toBe(before.gold + 9 * 50);
  });

  it('l\'objet est tiré AU TAP, pas au moment où le niveau est gagné', () => {
    // C'est ce qui garantit le zéro doublon : entre le niveau et la
    // récupération, le joueur a pu acheter la carte que le tirage aurait mise
    // de côté. Ici on la lui donne juste avant le tap — elle ne doit pas tomber.
    const user = newUser();
    levelTo(user().id, 10);

    const rand = shop.seededRandom(user().id, 'level', 10);
    const available = levels.pools(user());
    const kinds = levels.DRAW_KINDS.filter((k: string) => available[k].length);
    const wouldDrawKind = shop.pick(kinds, rand);
    const wouldDraw = shop.pick(available[wouldDrawKind], rand);

    // Acquis entre-temps, par un autre chemin (achat, booster, cadeau…).
    if (wouldDrawKind === 'card') progression.unlockCard(user().id, wouldDraw.id);
    else cosmetics.unlock(user().id, wouldDrawKind, wouldDraw.id);

    const item = levels.claim(user()).lines.find((l: any) => l.level === 10).item;
    expect(`${item.type}:${item.id}`).not.toBe(`${wouldDrawKind}:${wouldDraw.id}`);
  });
});

describe('annonce au joueur (preview)', () => {
  it('annonce les 4 prochains paliers, à partir du suivant', () => {
    const user = newUser();
    levelTo(user().id, 7);

    const view = levels.preview(user());
    expect(view.upcoming.map((u: any) => u.level)).toEqual([8, 9, 10, 11]);
    expect(view.upcoming[2]).toEqual({ level: 10, gold: 50, gems: 50, draw: true });
  });

  it('nomme les deux prochains rendez-vous — gemmes et objet', () => {
    const user = newUser();
    levelTo(user().id, 7);

    const view = levels.preview(user());
    expect(view.next_gems_level).toBe(10);
    expect(view.next_draw_level).toBe(10);
  });

  it('un palier tout juste atteint ne s\'annonce plus comme à venir', () => {
    const user = newUser();
    levelTo(user().id, 10);

    const view = levels.preview(user());
    expect(view.next_gems_level).toBe(15);
    expect(view.next_draw_level).toBe(20);
    expect(view.upcoming[0].level).toBe(11);
  });

  it('le barème annoncé est celui qui est appliqué', () => {
    // Le client ne recopie pas la règle : il affiche ce que le serveur annonce.
    // Les deux ne peuvent donc pas diverger — encore faut-il que l'annonce
    // vienne bien du barème et non d'une constante d'affichage.
    const user = newUser();
    const view = levels.preview(user());
    expect(view.rules.gold_per_level).toBe(levels.GOLD_PER_LEVEL);
    expect(view.rules.gems).toEqual({ every: 5, amount: 50 });
    expect(view.rules.draw.every).toBe(10);
    expect(view.rules.draw.kinds).toEqual(['card', 'avatar', 'variant']);

    progression.grant(user().id, { xp: 100 });
    expect(levels.claim(user()).granted.gold).toBe(view.rules.gold_per_level);
  });

  it('annonce ce qui attend le tap, paliers et total', () => {
    const user = newUser();
    levelTo(user().id, 12);

    const view = levels.preview(user());
    expect(view.pending.map((p: any) => p.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Le total est replié par le serveur : le bouton annonce un montant sans
    // que le client ait à sommer un barème qu'il ne connaît pas.
    expect(view.pending_totals).toEqual({ gold: 11 * 50, gems: 100, draws: 1 });
  });

  it('n\'annonce plus rien une fois le tap fait', () => {
    const user = newUser();
    levelTo(user().id, 6);
    levels.claim(user());

    const view = levels.preview(user());
    expect(view.pending).toEqual([]);
    expect(view.pending_totals).toEqual({ gold: 0, gems: 0, draws: 0 });
  });
});
