// Point d'entrée de la simulation d'équilibrage.
//
//   npx --prefix client vite-node src/sim/run.ts -- --games=60000 --ab-top=20
//
// ⚠️ `vite-node` (livré avec vitest) et non `node` : la couche `logic/` est en
// ESM TypeScript avec des imports en `.js`, que Node ne résout pas seul. C'est
// aussi pourquoi ce fichier vit sous `client/src/` — il y est couvert par
// `npm run lint` et `tsc --noEmit`, et rien dans l'application ne l'importe,
// donc il n'entre dans aucun bundle.
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from './catalog.js';
import { runAb, runDetector } from './protocol.js';
import { buildReport } from './report.js';

interface Args {
  games: number;
  abTop: number;
  abGames: number;
  seed: string;
  out: string | null;
  post: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const today = new Date().toISOString().slice(0, 10);
  return {
    games: Number(get('games') ?? 60000),
    abTop: Number(get('ab-top') ?? 20),
    abGames: Number(get('ab-games') ?? 600),
    // La graine par défaut est LE JOUR : deux runs du même jour se rejouent à
    // l'identique, et deux jours consécutifs ne rejouent pas la même partie.
    seed: get('seed') ?? today,
    out: get('out'),
    post: get('post'),
  };
}

async function postReport(url: string, report: unknown): Promise<void> {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || '';
  if (!pass) throw new Error('ADMIN_PASS manquant : le dépôt du rapport est une écriture /api, elle exige le site admin.');
  const body = JSON.stringify(report);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status} ${await res.text().catch(() => '')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cat = loadCatalog();

  console.log(`[sim] catalogue ${cat.fingerprint.source} — ${cat.fingerprint.cards} cartes (hash ${cat.fingerprint.hash})`);
  console.log(`[sim] graine « ${args.seed} » — ${args.games} parties`);

  const t0 = Date.now();
  const detector = runDetector(cat, args.games, args.seed);
  console.log(`[sim] détecteur : ${detector.games} parties en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`[sim]   ligne de base ${(100 * detector.baseline).toFixed(1)} % · ${detector.rows.filter(r => r.played > 0).length} cartes mesurées · ${detector.neverPlayed.length} jamais posées`);
  console.log(`[sim]   ${detector.rows.filter(r => r.significant).length} écarts significatifs`);

  // ⚠️ L'A/B ne part QUE des lignes significatives : c'est le contrat entre les
  // deux passes. Prendre le haut du classement sans ce filtre enverrait 600
  // parties confirmer une carte vue trois fois.
  const candidates = detector.rows
    .filter(r => r.significant)
    .slice(0, args.abTop)
    .map(r => cat.cardDb.getCard(r.card_id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const t1 = Date.now();
  const ab = candidates.length ? runAb(cat, candidates, args.abGames, args.seed) : [];
  console.log(`[sim] A/B : ${ab.length} cartes × ${2 * args.abGames} parties en ${((Date.now() - t1) / 1000).toFixed(1)} s`);

  const report = buildReport(cat, detector, ab, {
    seed: args.seed, abGamesPerArm: args.abGames, date: new Date().toISOString().slice(0, 10),
  });
  const json = JSON.stringify(report);
  console.log(`[sim] émission : ${report.show.segments.length} chapitres, ${report.show.words} mots, ~${Math.round(report.show.estimatedSeconds / 60)} min`);
  console.log(`[sim] rapport : ${(json.length / 1024).toFixed(0)} Ko`);
  if (json.length > 1024 * 1024) {
    console.warn('[sim] ⚠️ le rapport dépasse 1 Mo — le plafond de corps de /api le refusera.');
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, json);
    console.log(`[sim] écrit dans ${args.out}`);
  }
  if (args.post) {
    await postReport(args.post, report);
    console.log(`[sim] déposé sur ${args.post}`);
  }
  console.log(`[sim] terminé en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch(err => {
  console.error('[sim]', err);
  process.exit(1);
});
