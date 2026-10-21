import type { HoldRole } from '../types';

export const ROLE_COLORS: Record<HoldRole, string> = {
  start: '#22c55e',
  hand: '#ffffff',
  foot: '#3b82f6',
  finish: '#ef4444',
};

export const ROLE_LABELS: Record<HoldRole, string> = {
  start: 'Start',
  hand: 'Hand',
  foot: 'Foot only',
  finish: 'Finish',
};

// First tap makes an ordinary hand hold (white); keep tapping for the special roles.
const CYCLE: (HoldRole | null)[] = [null, 'hand', 'start', 'foot', 'finish'];

export function nextRole(role: HoldRole | null): HoldRole | null {
  return CYCLE[(CYCLE.indexOf(role) + 1) % CYCLE.length];
}
