import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Undo/redo over an immutable value. `set` records a step; `replace` changes the
 * present without one (for continuous drags, call `checkpoint` once at the start).
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next;
      if (value === s.present) return s;
      return { past: [...s.past.slice(-99), s.present], present: value, future: [] };
    });
  }, []);

  const replace = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => ({ ...s, present: typeof next === 'function' ? (next as (p: T) => T)(s.present) : next }));
  }, []);

  const checkpoint = useCallback(() => {
    setState((s) => ({ past: [...s.past.slice(-99), s.present], present: s.present, future: [] }));
  }, []);

  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  const reset = useCallback((value: T) => setState({ past: [], present: value, future: [] }), []);

  return {
    value: state.present,
    set,
    replace,
    checkpoint,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

/** Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (or Ctrl+Y), ignored while typing in a field. */
export function useUndoKeys(undo: () => void, redo: () => void) {
  const ref = useRef({ undo, redo });
  ref.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) ref.current.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') ref.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
