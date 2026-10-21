export type HoldShape =
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'polygon'; points: [number, number][] };

/** A hold outline on a specific wall photo. Coordinates are image pixels. */
export interface Hold {
  id: string;
  shape: HoldShape;
}

export interface Wall {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * One photo of a wall plus the holds outlined on it. Climbs are pinned to the
 * version they were set on, so a new photo never changes existing climbs.
 */
export interface WallVersion {
  id: string;
  wallId: string;
  number: number;
  image: Blob;
  width: number;
  height: number;
  holds: Hold[];
  createdAt: number;
  /** Where the photo lives on the server (server mode); `image` is the cached copy. */
  photoUrl?: string;
}

export type HoldRole = 'start' | 'hand' | 'foot' | 'finish';

export interface ClimbHold {
  holdId: string;
  role: HoldRole;
}

export interface Climb {
  id: string;
  wallId: string;
  versionId: string;
  name: string;
  gradeSystemId: string;
  grade: string;
  footRuleId: string;
  noMatching: boolean;
  /** A reference climb for its grade. Missing on climbs saved before benchmarks existed. */
  benchmark?: boolean;
  tagIds: string[];
  notes: string;
  holds: ClimbHold[];
  thumbnail?: Blob;
  /** Server mode: who set it. */
  createdBy?: string;
  setterName?: string;
  createdAt: number;
  updatedAt: number;
}

/** Someone's send of a climb (server mode). One per person per climb. */
export interface Tick {
  /** `${climbId}#${userId}` */
  id: string;
  climbId: string;
  userId: string;
  userName: string;
  /** Grade opinion, from the same scale as the climb. */
  grade: string;
  /** Quality, 0 (none given) to 3. */
  stars: number;
  note: string;
  date: number;
  updatedAt: number;
}

export interface ClimbList {
  id: string;
  name: string;
  climbIds: string[];
  createdAt: number;
}

export interface GradeSystem {
  id: string;
  name: string;
  grades: string[];
}

export interface FootRule {
  id: string;
  name: string;
  description: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface AppSettings {
  id: 'app';
  defaultGradeSystemId: string;
  defaultFootRuleId: string;
}
