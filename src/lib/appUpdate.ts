/**
 * After a new version is published, a copy of the app opened earlier can ask for
 * code files that no longer exist (each build renames them). Reload once to pick
 * up the new version; if that doesn't fix it, let the error show normally.
 */
const KEY = 'reloaded-for-update';

export function isStaleChunkError(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg);
}

/** Reload the page unless we just did; returns whether a reload is happening. */
export function reloadForUpdate(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, '1');
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** Import code that may have been renamed by a newer version. */
export async function importFresh<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (isStaleChunkError(e)) {
      if (reloadForUpdate()) return new Promise<T>(() => {}); // The page is reloading.
      throw new Error('The app was updated. Reload the page to use this.');
    }
    throw e;
  }
}

export function installUpdateRecovery() {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForUpdate()) e.preventDefault();
  });
  // Once the app has run fine for a bit, allow a future reload again.
  setTimeout(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Ignore.
    }
  }, 30_000);
}
