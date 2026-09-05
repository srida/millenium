/* eslint-disable @typescript-eslint/no-explicit-any */
// Banc d'essai des effets (`?screen=effectbench`).
//
// Prend CHAQUE effet écrit dans les trois catalogues — attributs, terrains,
// magies —, l'applique à une scène type, et montre ce qu'il fait en chiffres.
// Ceux qui ne font RIEN sont nommés, avec la raison quand on peut la donner.
//
// C'est la question qui a lancé tout ce chantier : `ARCH_019` n'a rien donné
// pendant des mois et rien dans le jeu ne pouvait le dire. Un attribut muet n'a
// pas d'écran, pas de message, pas de trace — il ressemble exactement à un
// attribut faible, et c'est comme ça qu'on le laisse en place.
//
// ⚠️ TOUTE la mesure vit dans `dev/effectBenchRun.ts`, qui est pur : ce fichier
// ne fait que rendre ce qu'il produit et récolter les filtres. C'est ce qui rend
// le sujet testable alors que la suite tourne en node sans jsdom — même partage
// que le Labo IA et `data/tutorialScript.ts`.
//
// ⚠️ Il lit les catalogues du SERVEUR (donc `data/`, le volume), et non
// `initial-data/` : c'est ce que l'admin édite et ce que le jeu joue. Le test
// (`effect-bench.test.ts`) fige l'autre, celui qui est livré.
//
// ⚠️ `IMMERSIVE_SCREENS` : cet écran pose son propre fond plein cadre
// (`h-dvh bg-surface`). L'oublier l'aurait rendu intégralement invisible — cf.
// « Labo IA » dans CLAUDE.md, et le test qui garde l'invariant.
import { useEffect, useMemo, useState } from 'react';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as BoardDatabase from '../data/BoardDatabase.js';
import * as MagieDatabase from '../data/MagieDatabase.js';
import { GAME_NAMES } from '../data/gameNames.js';
import { initGameData } from '../game/bootstrap.js';
import { useUiStore } from '../stores/uiStore.js';
import { runEffectBench } from './effectBenchRun.js';
import type { BenchReport, BenchRow, BenchVerdict, EffectDomain } from './effectBenchRun.js';

const btn = 'rounded border border-white/15 px-2 py-1 text-xs text-white/80 hover:border-white/40 disabled:opacity-30';
const btnOn = 'rounded border border-gold/70 bg-gold/15 px-2 py-1 text-xs text-gold';
const panel = 'rounded-lg border border-white/10 bg-black/30 p-3';
const labelCls = 'text-[10px] uppercase tracking-wide text-white/40';

const DOMAIN_LABELS: Record<EffectDomain, string> = {
  attribute: 'Attributs', board: 'Terrains', magie: 'Magies',
};

/**
 * ⚠️ Trois verdicts, trois couleurs, et le rouge n'est PAS pris par « muet »
 * par hasard : c'est la seule ligne sur laquelle on veut que l'œil tombe. Le
 * gris de « descriptif » dit « rien à voir ici » — quarante archétypes purs le
 * portent, et les teinter comme un problème noierait les vrais.
 */
const VERDICT_STYLE: Record<BenchVerdict, { chip: string; label: string }> = {
  actif: { chip: 'border-success/50 bg-success/10 text-success', label: 'actif' },
  muet: { chip: 'border-danger/60 bg-danger/15 text-danger', label: 'MUET' },
  descriptif: { chip: 'border-white/15 bg-white/5 text-white/40', label: 'descriptif' },
};

type DomainFilter = EffectDomain | 'all';
type VerdictFilter = BenchVerdict | 'all';

export default function EffectBench() {
  const navigate = useUiStore(s => s.navigate);

  const [report, setReport] = useState<BenchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [verdict, setVerdict] = useState<VerdictFilter>('muet');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await initGameData();
      if (!alive) return;
      setReport(runEffectBench({
        attributes: (AttributeDatabase as any).getAllAttributes(),
        boards: (BoardDatabase as any).getAllBoards(),
        magies: (MagieDatabase as any).getAllMagies(),
        names: GAME_NAMES,
      }));
    })().catch(e => setError(String(e?.message ?? e)));
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    return report.rows.filter(r =>
      (domain === 'all' || r.domain === domain)
      && (verdict === 'all' || r.verdict === verdict)
      && (!q || `${r.entity_id} ${r.entity_name} ${r.type ?? ''} ${r.label}`.toLowerCase().includes(q)));
  }, [report, domain, verdict, query]);

  return (
    <div className="flex h-dvh flex-col bg-surface text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2">
        <button className={btn} onPointerUp={() => navigate('main_menu')}>◂ Menu</button>
        <h1 className="text-sm font-semibold text-gold">Banc d'essai des effets</h1>
        {report && (
          <span className="ml-auto text-xs text-white/50">
            {report.counts.total} effets · <span className="text-danger">{report.counts.muet} muets</span>
          </span>
        )}
      </header>

      {error && <p className="p-4 text-sm text-danger">{error}</p>}
      {!report && !error && <p className="p-4 text-sm text-white/50">Mesure des effets…</p>}

      {report && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mx-auto flex max-w-4xl flex-col gap-3">

            {/* Le décompte par domaine — la vue d'ensemble, avant tout filtre. */}
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(DOMAIN_LABELS) as EffectDomain[]).map(d => {
                const c = report.byDomain[d];
                return (
                  <div key={d} className={`${panel} min-w-0`}>
                    <p className={labelCls}>{DOMAIN_LABELS[d]}</p>
                    <p className="text-lg font-semibold">{c.total}</p>
                    <p className="text-[11px] text-white/50">
                      <span className="text-success">{c.actif} actifs</span>
                      {c.muet > 0 && <> · <span className="text-danger">{c.muet} muets</span></>}
                      {c.descriptif > 0 && <> · {c.descriptif} descr.</>}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* ⚠️ La scène est annoncée AVANT les verdicts, et pas en note de bas
                de page : « muet » se lit « n'a rien fait ici », jamais « ne fait
                jamais rien ». Un diagnostic dont on ignore les conditions se
                lirait comme un jugement. */}
            <p className={`${panel} text-[11px] leading-relaxed text-white/50`}>
              <span className={labelCls}>Scène type</span><br />
              {report.scene} Chaque effet est joué SEUL, de bout en bout : début de
              combat, une mort, fin de combat. Un verdict « muet » dit que rien n'a
              bougé <em>sur cette scène</em>.
            </p>

            {/* Filtres */}
            <div className={`${panel} flex flex-wrap items-center gap-2`}>
              <span className={labelCls}>Domaine</span>
              {(['all', 'attribute', 'board', 'magie'] as DomainFilter[]).map(d => (
                <button key={d} className={domain === d ? btnOn : btn} onPointerUp={() => setDomain(d)}>
                  {d === 'all' ? 'Tous' : DOMAIN_LABELS[d]}
                </button>
              ))}
              <span className={`${labelCls} ml-2`}>Verdict</span>
              {(['muet', 'actif', 'descriptif', 'all'] as VerdictFilter[]).map(v => (
                <button key={v} className={verdict === v ? btnOn : btn} onPointerUp={() => setVerdict(v)}>
                  {v === 'all' ? 'Tous' : VERDICT_STYLE[v].label}
                </button>
              ))}
              <input
                // ⚠️ `basis-full` en portrait : sur une rangée qui passe à la
                // ligne, un `flex-1` se contente du reliquat de la dernière —
                // le champ y était rogné à « Filtr ».
                className="min-w-0 basis-full rounded border border-white/15 bg-black/40 px-2 py-1 text-xs sm:ml-auto sm:basis-auto sm:flex-1"
                placeholder="Filtrer (id, nom, type…)"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            {rows.length === 0 && (
              <p className={`${panel} text-center text-sm text-white/40`}>
                {verdict === 'muet'
                  ? 'Aucun effet muet — tout ce qui est écrit dans les catalogues agit.'
                  : 'Aucun effet ne correspond à ce filtre.'}
              </p>
            )}

            <div className="flex flex-col gap-2">
              {rows.map(row => (
                <Row key={row.key} row={row} open={open === row.key}
                  onToggle={() => setOpen(open === row.key ? null : row.key)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Un seuil frappe les dix unités de la scène à l'identique : listées une par
 * une, c'est dix fois « bouclier 0 → 300 » et l'écart qui compte — une unité
 * qui n'a PAS reçu la même chose — se noie dedans. On regroupe par ce qui est
 * arrivé, pas par à qui.
 *
 * ⚠️ Regroupement d'AFFICHAGE seulement : le pilote rend une observation par
 * sujet, et c'est ce que le test lit.
 */
function groupObservations(row: BenchRow): { detail: string; subjects: string[] }[] {
  const groups: { detail: string; subjects: string[] }[] = [];
  for (const o of row.observed) {
    const g = groups.find(x => x.detail === o.detail);
    if (g) g.subjects.push(o.subject); else groups.push({ detail: o.detail, subjects: [o.subject] });
  }
  return groups;
}

function Row({ row, open, onToggle }: { row: BenchRow; open: boolean; onToggle: () => void }) {
  const style = VERDICT_STYLE[row.verdict];
  return (
    <div className={`${panel} min-w-0`}>
      <button className="flex w-full min-w-0 items-start gap-2 text-left" onPointerUp={onToggle}>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}>
          {style.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            <span className="text-white/40">{row.entity_id}</span>{' '}
            <span className="font-medium">{row.entity_name}</span>
            {row.where && <span className="text-white/40"> · {row.where}</span>}
          </span>
          <span className="block truncate text-xs text-white/60">{row.label}</span>
        </span>
        <span className="shrink-0 text-right text-[10px] text-white/35">
          {row.type ?? '—'}
          {row.timing && <><br />{row.timing}</>}
          {row.cost_hp > 0 && <><br />{row.cost_hp} PV</>}
        </span>
      </button>

      {/* La raison est TOUJOURS visible sur un muet, repliée ou non : c'est la
          seule information que l'écran existe pour donner. */}
      {row.note && (
        <p className="mt-2 border-l-2 border-danger/50 pl-2 text-xs text-danger/90">{row.note}</p>
      )}

      {open && (
        <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2">
          {row.observed.length > 0 && (
            <div>
              <p className={labelCls}>Observé</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-white/70">
                {groupObservations(row).map((g, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex-1">{g.detail}</span>
                    <span className="shrink-0 text-white/35">
                      {g.subjects.length > 2 ? `${g.subjects.length} unités` : g.subjects.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="min-w-0">
            <p className={labelCls}>Effet écrit</p>
            {/* Le JSON déborde en portrait : il défile DANS sa boîte, jamais le
                document (cf. la règle `min-w-0` des tuiles denses). */}
            <pre className="mt-1 overflow-x-auto rounded bg-black/50 p-2 text-[10px] text-white/60">
              {JSON.stringify(row.effect, null, 1)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
