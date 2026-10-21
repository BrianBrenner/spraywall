import type { Climb } from '../types';
import { useSession, type Session } from './auth';
import { backend } from './config';

export interface Permissions {
  /** Talking to the shared server (vs. this device only). */
  server: boolean;
  session: Session | null;
  signedIn: boolean;
  /** Walls, photos, holds, lists, settings, members. */
  isOwner: boolean;
  /** Set new climbs and tick. */
  canSet: boolean;
  /** Edit or delete this climb (its setter, or the owner). */
  canEdit: (climb: Pick<Climb, 'createdBy'>) => boolean;
}

/** Local mode: you own everything. Server mode: per the access rules. */
export function usePermissions(): Permissions {
  const session = useSession();
  if (!backend) return { server: false, session: null, signedIn: false, isOwner: true, canSet: true, canEdit: () => true };
  const isOwner = !!session?.isOwner;
  return {
    server: true,
    session,
    signedIn: !!session,
    isOwner,
    canSet: !!session,
    canEdit: (climb) => !!session && (isOwner || climb.createdBy === session.sub),
  };
}
