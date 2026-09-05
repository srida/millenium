// La barre de requête du jeu — le même langage que celle de l'admin.
//
// ⚠️ Le moteur vit dans `card-query.mjs` À LA RACINE, et c'est délibéré :
// `admin.html` (page autonome, sans build) et ce bundle le partagent. Écrire la
// grammaire deux fois aurait donné deux langages qui divergent au premier champ
// ajouté — et personne ne s'en apercevrait avant qu'une requête apprise dans
// l'admin ne rende rien dans le jeu.
//
// Ce composant ne connaît AUCUN champ : le schéma lui est passé. Il ne fait que
// le champ, la liste de complétion, la ligne d'erreur et l'aide.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import * as Query from '../../../../card-query.mjs';
import { Modal, Button } from './primitives.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Schema = any;

export type QueryBarProps = {
  value: string;
  onChange: (next: string) => void;
  schema: Schema;
  /** Message d'erreur d'analyse, calculé par l'appelant (il filtre déjà). */
  error?: string | null;
  placeholder?: string;
  examples?: { q: string; why: string }[];
};

export default function QueryBar({ value, onChange, schema, error, placeholder, examples = [] }: QueryBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [help, setHelp] = useState(false);

  // ⚠️ La liste ne s'ouvre QUE quand le curseur est posé quelque part
  // (`caret !== null`) : sans ce garde, elle s'ouvrait au montage sur une barre
  // que personne n'avait touchée, et couvrait la première rangée de cartes.
  const suggestion = useMemo(
    () => (caret === null ? null : Query.suggest(value, caret, schema)),
    [value, caret, schema],
  );
  const items: any[] = suggestion?.items ?? [];

  function apply(item: any) {
    if (!suggestion) return;
    const next = Query.applySuggestion(value, suggestion, item.value);
    onChange(next.text);
    // Le focus et le curseur sont reposés APRÈS le rendu contrôlé, sinon React
    // les replace en fin de champ et la complétion suivante vise à côté.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? 'Rechercher…'}
          value={value}
          onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart)}
          onFocus={(e) => setCaret(e.target.selectionStart)}
          // Le délai laisse le tap sur une proposition arriver avant que la
          // liste ne se ferme — un `blur` sec la ferait disparaître sous le doigt.
          onBlur={() => setTimeout(() => setCaret(null), 150)}
          onKeyDown={(e) => { if (e.key === 'Escape') setCaret(null); }}
          className="min-h-tap w-full flex-1 rounded-lg border border-line bg-surface-raised px-3 font-mono text-sm text-white placeholder:font-sans placeholder:text-white/30"
        />
        <button
          type="button"
          onPointerDown={() => setHelp(true)}
          aria-label="Aide de la recherche"
          className="min-h-tap min-w-tap shrink-0 rounded-lg border border-line bg-surface-raised text-sm font-bold text-white/50"
        >?</button>
      </div>

      {error && <p className="mt-1 text-[11px] leading-snug text-tier-4">{error}</p>}

      {items.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl">
          {items.map((it: any) => (
            <button
              key={it.value + it.label}
              type="button"
              // `onPointerDown` et non `onClick` : le `blur` du champ part avant
              // le clic, et la liste serait démontée avant de le recevoir.
              onPointerDown={(e) => { e.preventDefault(); apply(it); }}
              className="flex w-full min-h-tap items-baseline gap-2 px-3 text-left text-xs hover:bg-surface-raised"
            >
              <code className="font-mono text-gold">{it.label ?? it.value}</code>
              {it.hint && <span className="truncate text-[11px] text-white/40">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}

      {help && <QueryHelp schema={schema} examples={examples} onPick={(q) => { onChange(q); setHelp(false); }} onClose={() => setHelp(false)} />}
    </div>
  );
}

function Row({ code, children }: { code: string; children: ReactNode }) {
  return (
    <>
      <code className="font-mono text-[11px] text-gold">{code}</code>
      <span className="text-[11px] text-white/50">{children}</span>
    </>
  );
}

function QueryHelp({ schema, examples, onPick, onClose }: {
  schema: Schema; examples: { q: string; why: string }[];
  onPick: (q: string) => void; onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-base font-semibold text-gold">Rechercher</h2>
      <p className="mb-3 text-xs text-white/50">
        Un mot cherche dans le nom. Les termes se cumulent en <b>ET</b>.
      </p>
      <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <Row code="tier:3">égal / contient</Row>
        <Row code="atk&gt;=30">sur les nombres</Row>
        <Row code="tier:3,4">l’un de</Row>
        <Row code="a OU b">OU explicite</Row>
        <Row code="-illustration">négation</Row>
        <Row code="(a OU b) c">parenthèses</Row>
        <Row code="pouvoir:vide">champ absent</Row>
      </div>

      {examples.length > 0 && (
        <>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">Exemples</div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {examples.map(e => (
              <button
                key={e.q} type="button" onPointerDown={() => onPick(e.q)} title={e.why}
                className="min-h-tap rounded-full border border-line bg-surface-raised px-3 font-mono text-[11px] text-white/70"
              >{e.q}</button>
            ))}
          </div>
        </>
      )}

      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">Champs</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {schema.fields.map((f: any) => (
          <Row key={f.key} code={f.key}>{f.label}</Row>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button onPointerDown={onClose} variant="ghost">Fermer</Button>
      </div>
    </Modal>
  );
}
