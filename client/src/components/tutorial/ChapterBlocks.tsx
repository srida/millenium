/* eslint-disable @typescript-eslint/no-explicit-any */
// Rendu d'un chapitre du codex. Les exemples ne sont pas décrits ici : ils sont
// RÉSOLUS à l'affichage contre les vrais catalogues, de sorte que le tutoriel
// montre les cartes, pouvoirs, attributs, magies et terrains réellement servis
// par l'API — jamais une copie qui pourrait diverger.
//
// Les vignettes passent par CardTile, comme partout ailleurs : mêmes
// illustrations, même appui long → tooltip. Un joueur qui apprend ici retrouve
// exactement les mêmes gestes en partie.
import type { ReactNode } from 'react';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as PowerDatabase from '../../data/PowerDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as MagieDatabase from '../../data/MagieDatabase.js';
import * as BoardDatabase from '../../data/BoardDatabase.js';
import AttrIcon from '../ui/AttrIcon.js';
import { effectLabel } from '../../logic/MagieEffect.js';
import type { Card, AttributeDef, BoardDef, Magie, PowerDef } from '../../logic/types.js';
import type { ChapterBlock } from '../../data/tutorialContent.js';
import CardTile, { cardTileProps } from '../ui/CardTile.js';
import { Illustration } from '../ui/primitives.js';

// Les textes du codex portent quelques **passages en gras** — juste assez de
// balisage pour souligner un terme, sans embarquer un moteur Markdown.
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**')
        ? <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>
      ))}
    </>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[10px] tracking-widest text-white/40">{children}</div>;
}

/** Tri par id avant découpe : un exemple ne doit pas changer d'une visite à l'autre. */
function firstById<T extends { id: string }>(list: T[], limit: number): T[] {
  return [...(list ?? [])].sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
}

// ── Exemples tirés des catalogues ───────────────────────────────────────────

function PowerExamples({ limit }: { limit: number }) {
  const powers = firstById((PowerDatabase as any).getAllPowers() as PowerDef[], limit);
  return (
    <div className="grid gap-1.5">
      {powers.map(p => (
        <div key={p.id} className="rounded-lg border border-line bg-surface-raised/60 px-3 py-2">
          <div className="text-xs font-semibold text-gold">{p.name}</div>
          {p.description && <div className="text-[11px] leading-snug text-white/60">{p.description}</div>}
        </div>
      ))}
    </div>
  );
}

function AttributeExamples({ limit }: { limit: number }) {
  // Un attribut sans palier n'illustre rien : on ne montre que ceux qui portent
  // vraiment une synergie.
  const all = ((AttributeDatabase as any).getAllAttributes() as AttributeDef[])
    .filter(a => (a.thresholds?.length ?? 0) > 0);
  return (
    <div className="grid gap-1.5">
      {firstById(all, limit).map(a => (
        <div key={a.id} className="rounded-lg border border-line bg-surface-raised/60 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gold">
            <AttrIcon id={a.id} className="h-5 w-5 text-base" />
            {a.name}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.thresholds.map(t => (
              <span key={t.count} className="rounded-full border border-line px-2 py-0.5 text-[10px] tabular-nums text-white/60">
                {t.count} cartes
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MagieExamples({ limit }: { limit: number }) {
  const magies = firstById((MagieDatabase as any).getAllMagies() as Magie[], limit);
  return (
    <div className="grid gap-1.5">
      {magies.map(m => (
        <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/60 p-2">
          {m._has_illustration && (
            <Illustration id={m.id} className="h-10 w-10 rounded" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gold">{m.name}</div>
            {/* La description est facultative dans les données — l'effet, lui, est toujours descriptible. */}
            <div className="text-[11px] leading-snug text-white/60">{(m as any).description ?? effectLabel(m)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardExamples({ limit }: { limit: number }) {
  const boards = firstById((BoardDatabase as any).getAllBoards() as BoardDef[], limit);
  return (
    <div className="grid gap-1.5">
      {boards.map(b => {
        const blocked = b.blocked_cells?.length ?? 0;
        return (
          <div key={b.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/60 p-2">
            {b._has_illustration && (
              <Illustration id={b.id} className="h-10 w-10 rounded" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gold">{b.name}</div>
              <div className="text-[11px] leading-snug text-white/60">
                {blocked > 0 ? `${blocked} case${blocked > 1 ? 's' : ''} bloquée${blocked > 1 ? 's' : ''}` : 'Aucun obstacle'}
                {b.effect?.stat ? ` · +${b.effect.value} ${b.effect.stat.toUpperCase()}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardExamples({ pick, caption }: { pick: (cards: Card[]) => Card[]; caption?: string }) {
  const cards = pick((CardDatabase as any).getAllCards() as Card[]);
  if (!cards.length) return null;
  return (
    <div>
      {caption && <Caption>{caption}</Caption>}
      <div className="flex flex-wrap gap-2">
        {cards.map(c => (
          <div key={c.id} className="w-20">
            <CardTile {...cardTileProps(c)} size="h-auto w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bloc ────────────────────────────────────────────────────────────────────

export function ChapterBlockView({ block }: { block: ChapterBlock }) {
  switch (block.kind) {
    case 'text':
      return <p className="text-sm leading-relaxed text-white/70"><RichText text={block.text} /></p>;

    case 'bullets':
      return (
        <ul className="space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-white/70">
              <span className="text-gold/60" aria-hidden>▪</span>
              <span><RichText text={item} /></span>
            </li>
          ))}
        </ul>
      );

    case 'table':
      return (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-surface-raised/80 text-[10px] tracking-widest text-white/40">
                <th className="px-3 py-1.5 font-normal">{block.head[0]}</th>
                <th className="px-3 py-1.5 font-normal">{block.head[1]}</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-gold">{row[0]}</td>
                  <td className="px-3 py-1.5 leading-snug text-white/70">{row[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'note':
      return (
        <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-white/70">
          <RichText text={block.text} />
        </div>
      );

    case 'cards':
      return <CardExamples pick={block.pick} caption={block.caption} />;

    case 'powers':
      return <div>{block.caption && <Caption>{block.caption}</Caption>}<PowerExamples limit={block.limit} /></div>;

    case 'attributes':
      return <div>{block.caption && <Caption>{block.caption}</Caption>}<AttributeExamples limit={block.limit} /></div>;

    case 'magies':
      return <div>{block.caption && <Caption>{block.caption}</Caption>}<MagieExamples limit={block.limit} /></div>;

    case 'boards':
      return <div>{block.caption && <Caption>{block.caption}</Caption>}<BoardExamples limit={block.limit} /></div>;

    default:
      return null;
  }
}

export default ChapterBlockView;
