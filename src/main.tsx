import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureSeeded } from './db';
import { pull, refreshMe } from './lib/mutations';
import { ensureThumbnails } from './lib/thumbnail';
import './styles.css';

// Stop iPad Safari from zooming the whole page on pinch; the wall view handles its own zoom.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault());
}

ensureSeeded().then(() => {
  // Fills in any thumbnails that are missing (after an import or a colour change).
  ensureThumbnails();
  // Server mode: refresh the shared walls and climbs now and whenever the app comes back to the front.
  const refresh = () => {
    refreshMe();
    pull().catch((e) => console.warn('Couldn’t refresh from the server', e));
  };
  refresh();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
