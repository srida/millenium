// `resolveSfx` est la seule vraie RÈGLE de ce lot : quel fichier jouer pour un
// déclencheur qui porte une variante (tier pour l'invocation, élément pour
// l'attaque). Golden test de la priorité EXACT > REPLI > rien.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const RAW = [
  { id: 'SFX_SUMMON_T1', name: 'Invocation T1', trigger: 'summon', tier: 1, _has_audio: true },
  { id: 'SFX_SUMMON_GENERIC', name: 'Invocation (repli)', trigger: 'summon', _has_audio: true },
  { id: 'SFX_ATTACK_FEU', name: 'Attaque Feu', trigger: 'attack', element: 'ARCH_048', _has_audio: true },
  { id: 'SFX_ATTACK_NO_FILE', name: 'Attaque Eau (sans fichier)', trigger: 'attack', element: 'ARCH_049', _has_audio: false },
  { id: 'SFX_READY', name: 'Prêt', trigger: 'ready', _has_audio: true },
  { id: 'SFX_PHASE_COMBAT_NO_FILE', name: 'Phase Combat (sans fichier)', trigger: 'phase_combat', _has_audio: false },
];

describe('SfxDatabase.resolveSfx', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RAW) })));
  });

  it('choisit la variante EXACTE du tier quand elle existe', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    expect(db.resolveSfx('summon', { tier: 1 })?.id).toBe('SFX_SUMMON_T1');
  });

  it('retombe sur le REPLI générique pour un tier non couvert', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    expect(db.resolveSfx('summon', { tier: 3 })?.id).toBe('SFX_SUMMON_GENERIC');
  });

  it('choisit la variante EXACTE de l\'élément quand elle existe', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    expect(db.resolveSfx('attack', { element: 'ARCH_048' })?.id).toBe('SFX_ATTACK_FEU');
  });

  it('un déclencheur sans variante posée ignore la variante demandée', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    expect(db.resolveSfx('ready', { tier: 4 })?.id).toBe('SFX_READY');
  });

  it('une entrée SANS FICHIER n\'est jamais un candidat — retombe sur un autre son du même déclencheur', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    // ARCH_049 (Eau) n'a pas de fichier : seule l'entrée Feu reste candidate.
    expect(db.resolveSfx('attack', { element: 'ARCH_049' })?.id).toBe('SFX_ATTACK_FEU');
  });

  it('aucun candidat quand TOUTES les entrées du déclencheur sont sans fichier', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    expect(db.resolveSfx('phase_combat')).toBeNull();
  });

  it('aucun candidat pour un déclencheur totalement absent du catalogue', async () => {
    const db = await import('../data/SfxDatabase.js');
    await db.init();
    expect(db.resolveSfx('drag')).toBeNull();
  });
});
