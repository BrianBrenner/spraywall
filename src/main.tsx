import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureSeeded } from './db';
import { ensureThumbnails } from './lib/thumbnail';
import './styles.css';

// Stop iPad Safari from zooming the whole page on pinch; the wall view handles its own zoom.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault());
}

ensureSeeded().then(() => {
  // Fills in any thumbnails that are missing (after an import or a colour change).
  ensureThumbnails();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
