// TutorialScreen — le codex du jeu, plus les deux portes vers la pratique.
//
// Un seul écran porte le sommaire ET le lecteur de chapitre : ouvrir un
// chapitre n'est pas une navigation (rien à retrouver, rien à deep-linker),
// c'est un état local. Le ◂ de l'en-tête revient donc au sommaire quand un
// chapitre est ouvert, et au menu sinon — le geste est le même, il défait
// toujours la dernière chose faite.
//
// Accessible en INVITÉ, contrairement aux Missions et à la Boutique : c'est
// justement le joueur sans compte qu'il s'agit d'accueillir.
import { useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { CHAPTERS, type Chapter } from '../data/tutorialContent.js';
import { getProgress, markChapterRead, updateProgress, type TutorialProgress } from '../data/tutorialProgress.js';
import { Button } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import ChapterBlockView from '../components/tutorial/ChapterBlocks.js';

export default function TutorialScreen() {
  const navigate = useUiStore(s => s.navigate);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [progress, setProgress] = useState<TutorialProgress>(() => getProgress());

  // Arriver ici vaut avoir rencontré le tutoriel : l'invitation du premier
  // lancement ne doit plus se déclencher derrière.
  useEffect(() => {
    setProgress(updateProgress({ dismissed: true }));
  }, []);

  function open(idx: number) {
    setOpenIdx(idx);
    setProgress(markChapterRead(CHAPTERS[idx].id));
  }

  const chapter = openIdx != null ? CHAPTERS[openIdx] : null;

  return (
    <main className="flex min-h-dvh flex-col relative z-10 text-white" onPointerDown={hideTooltip}>
      <ScreenHeader
        title={chapter ? chapter.title : 'Tutoriel'}
        onBack={() => (chapter ? setOpenIdx(null) : navigate('main_menu'))}
        right={chapter ? <span className="text-xs tabular-nums text-white/40">{openIdx! + 1}/{CHAPTERS.length}</span> : undefined}
      />

      {chapter
        ? (
          <ChapterReader
            chapter={chapter}
            index={openIdx!}
            onNavigate={open}
            onFinish={() => setOpenIdx(null)}
          />
        )
        : (
          <TableOfContents
            progress={progress}
            onOpen={open}
            onPractice={() => navigate('game', { tutorial: true })}
            onBuild={() => navigate('deck_builder', { tutorial: true, mode: 'manage' })}
          />
        )}
    </main>
  );
}

// ── Sommaire ────────────────────────────────────────────────────────────────

function TableOfContents({
  progress, onOpen, onPractice, onBuild,
}: {
  progress: TutorialProgress;
  onOpen: (idx: number) => void;
  onPractice: () => void;
  onBuild: () => void;
}) {
  const read = new Set(progress.chapters);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
      <p className="text-sm leading-relaxed text-white/60">
        Millenium est un auto-battler : tu prépares un board, puis le combat se résout tout seul.
        Ces onze fiches expliquent tout ce qu'il faut savoir. Tu peux aussi passer directement à la pratique.
      </p>

      <div>
        <h2 className="mb-2 text-[10px] tracking-widest text-white/40">
          LES RÈGLES · {read.size}/{CHAPTERS.length} LUES
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHAPTERS.map((c, idx) => (
            <button
              key={c.id}
              onPointerDown={() => onOpen(idx)}
              className="flex min-h-tap items-start gap-3 rounded-xl border border-line bg-surface-raised/70 p-3 text-left active:opacity-80"
            >
              <span className="text-xl leading-none" aria-hidden>{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-white">{c.title}</span>
                  {read.has(c.id) && <span className="text-xs text-success" aria-label="Lu">✓</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/50">{c.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-[10px] tracking-widest text-white/40">LA PRATIQUE</h2>
        <div className="flex flex-col gap-2">
          <PracticeButton
            label="▸ Partie d'entraînement"
            hint="Une vraie partie contre l'IA, guidée pas à pas."
            done={progress.game}
            onTap={onPractice}
          />
          <PracticeButton
            label="▸ Créer mon premier deck"
            hint="20 cartes minimum, 8 par tier — accompagné."
            done={progress.deck}
            onTap={onBuild}
          />
        </div>
      </div>
    </div>
  );
}

function PracticeButton({ label, hint, done, onTap }: { label: string; hint: string; done: boolean; onTap: () => void }) {
  return (
    <button
      onPointerDown={onTap}
      className="flex min-h-tap flex-col items-start justify-center rounded-xl border border-gold/50 bg-gold/10 px-4 py-2.5 text-left active:opacity-80"
    >
      <span className="flex w-full items-center gap-2">
        <span className="text-sm font-semibold text-gold">{label}</span>
        {done && <span className="ml-auto text-xs text-success" aria-label="Fait">✓</span>}
      </span>
      <span className="text-[11px] text-white/50">{hint}</span>
    </button>
  );
}

// ── Lecteur ─────────────────────────────────────────────────────────────────

function ChapterReader({
  chapter, index, onNavigate, onFinish,
}: {
  chapter: Chapter;
  index: number;
  onNavigate: (idx: number) => void;
  onFinish: () => void;
}) {
  const last = index >= CHAPTERS.length - 1;

  return (
    <>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        {chapter.blocks.map((block, i) => (
          <ChapterBlockView key={i} block={block} />
        ))}
      </div>

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          className="px-3"
          disabled={index === 0}
          aria-label="Chapitre précédent"
          onPointerDown={() => onNavigate(index - 1)}
        >
          ◂
        </Button>
        <div className="flex-1 text-center text-[11px] tabular-nums text-white/40">
          {index + 1} / {CHAPTERS.length}
        </div>
        {last
          ? <Button variant="primary" onPointerDown={onFinish}>▸ Passer à la pratique</Button>
          : <Button variant="primary" onPointerDown={() => onNavigate(index + 1)}>Suivant ▸</Button>}
      </div>
    </>
  );
}
