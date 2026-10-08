// Bouton d'options (admins) : afficher / masquer l'indicateur mémoire.
import { useAuthStore } from '../../stores/authStore.js';
import { useMemoryStore } from '../../stores/memoryStore.js';
import { Button } from './primitives.js';

export default function MemoryToggle() {
  const isAdmin = useAuthStore(s => !!s.user?.is_admin);
  const visible = useMemoryStore(s => s.visible);
  const toggle = useMemoryStore(s => s.toggle);
  if (!isAdmin) return null;
  return (
    <Button className="w-full" onPointerDown={(e) => { e.stopPropagation(); toggle(); }}>
      {visible ? 'Masquer' : 'Afficher'} l&apos;indicateur mémoire
    </Button>
  );
}
