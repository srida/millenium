// Bouton ⚙ du header des menus : volumes (le même bloc que le menu d'options
// en jeu, `VolumeSliders`) et déconnexion quand un compte est connecté.
import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Button, IconButton, Modal } from '../ui/primitives.js';
import UiIcon from '../ui/UiIcon.js';
import VolumeSliders from '../ui/VolumeSliders.js';

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const navigate = useUiStore(s => s.navigate);

  return (
    <>
      <IconButton
        compact label="Paramètres" className="shrink-0"
        icon={<UiIcon id="UI_MENU" className="h-5 w-5" />}
        onTap={() => setOpen(true)}
      />
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="mb-3 text-base font-bold">Paramètres</div>
          <div className="space-y-2">
            <VolumeSliders />
            {user && (
              <Button
                variant="danger" className="w-full"
                onPointerDown={() => { setOpen(false); void logout(); navigate('main_menu'); }}
              >
                Se déconnecter
              </Button>
            )}
            <Button className="w-full" onPointerDown={() => setOpen(false)}>Fermer</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
