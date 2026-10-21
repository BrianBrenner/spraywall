import type { Table } from 'dexie';
import JSZip from 'jszip';
import { db } from '../db';
import type { AppSettings, Climb, ClimbList, FootRule, GradeSystem, Tag, Wall, WallVersion } from '../types';

const FORMAT = 'spraywall-export';
const FORMAT_VERSION = 1;

type ExportedVersion = Omit<WallVersion, 'image'> & { imageFile: string };
type ExportedClimb = Omit<Climb, 'thumbnail'>;

interface ExportData {
  format: typeof FORMAT;
  formatVersion: number;
  exportedAt: string;
  walls: Wall[];
  versions: ExportedVersion[];
  climbs: ExportedClimb[];
  lists: ClimbList[];
  gradeSystems: GradeSystem[];
  footRules: FootRule[];
  tags: Tag[];
  settings: AppSettings[];
}

/** Everything in one zip: data.json plus the wall photos. Thumbnails are regenerated on import. */
export async function exportAll(): Promise<Blob> {
  const zip = new JSZip();
  const versions = await db.versions.toArray();
  const data: ExportData = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    walls: await db.walls.toArray(),
    versions: versions.map(({ image, ...v }) => {
      const imageFile = `images/${v.id}.${image.type === 'image/png' ? 'png' : 'jpg'}`;
      zip.file(imageFile, image);
      return { ...v, imageFile };
    }),
    climbs: (await db.climbs.toArray()).map(({ thumbnail: _t, ...c }) => c),
    lists: await db.lists.toArray(),
    gradeSystems: await db.gradeSystems.toArray(),
    footRules: await db.footRules.toArray(),
    tags: await db.tags.toArray(),
    settings: await db.settings.toArray(),
  };
  zip.file('data.json', JSON.stringify(data, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

export type ImportMode = 'replace' | 'merge';

export interface ImportSummary {
  walls: number;
  climbs: number;
  lists: number;
}

/**
 * `replace` wipes local data first. `merge` adds only records whose id isn't
 * already here, so importing the same file twice is harmless.
 */
export async function importAll(file: Blob, mode: ImportMode): Promise<ImportSummary> {
  const zip = await JSZip.loadAsync(file);
  const json = await zip.file('data.json')?.async('string');
  if (!json) throw new Error('Not a spray wall export: data.json is missing.');
  const data = JSON.parse(json) as ExportData;
  if (data.format !== FORMAT) throw new Error('Not a spray wall export.');
  if (data.formatVersion > FORMAT_VERSION) throw new Error('This export is from a newer version of the app.');

  const versions: WallVersion[] = await Promise.all(
    data.versions.map(async ({ imageFile, ...v }) => {
      const entry = zip.file(imageFile);
      if (!entry) throw new Error(`Missing photo ${imageFile}.`);
      const type = imageFile.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return { ...v, image: new Blob([await entry.async('arraybuffer')], { type }) };
    }),
  );

  const tables = [db.walls, db.versions, db.climbs, db.lists, db.gradeSystems, db.footRules, db.tags, db.settings];
  const summary: ImportSummary = { walls: 0, climbs: 0, lists: 0 };
  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') await Promise.all(tables.map((t) => t.clear()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const put = async <T extends { id: string }>(table: Table<T, any, any>, items: T[]) => {
      let fresh = items;
      if (mode === 'merge') {
        const existing = await table.bulkGet(items.map((i) => i.id));
        fresh = items.filter((_, i) => !existing[i]);
      }
      await table.bulkPut(fresh);
      return fresh.length;
    };
    summary.walls = await put(db.walls, data.walls);
    await put(db.versions, versions);
    summary.climbs = await put(db.climbs, data.climbs);
    summary.lists = await put(db.lists, data.lists);
    await put(db.gradeSystems, data.gradeSystems);
    await put(db.footRules, data.footRules);
    await put(db.tags, data.tags);
    await put(db.settings, data.settings);
  });
  return summary;
}

/**
 * On iPad/iPhone the share sheet lets you AirDrop or save to Files; elsewhere
 * fall back to a normal download.
 */
export async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type || 'application/zip' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
