import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * The app caches itself for offline use, so a new version only takes over after
 * a reload. Check for one whenever the app comes back to the front (iPhone Home
 * Screen apps resume rather than reload), and let the person choose when to switch.
 */
let needRefresh = false;
const listeners = new Set<() => void>();

const updateSW = registerSW({
  onNeedRefresh() {
    needRefresh = true;
    listeners.forEach((l) => l());
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  },
});

export function useUpdateAvailable() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => needRefresh,
  );
}

/** Switch to the new version now (reloads the page). */
export const applyUpdate = () => updateSW(true);
