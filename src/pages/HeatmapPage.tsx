import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { HoldOutline } from '../components/HoldOutline';
import { PageHeader } from '../components/ui';
import { WallCanvas } from '../components/WallCanvas';
import { db } from '../db';
import { shapePath } from '../lib/geometry';
import { blobUrl } from '../lib/image';
import type { HoldRole } from '../types';

type Include = 'all' | 'hands';

/** How often each hold on a photo is used, to spot overused and never-used holds. */
export function HeatmapPage() {
  const { versionId } = useParams();
  const [include, setInclude] = useState<Include>('all');
  const data = useLiveQuery(async () => {
    const version = await db.versions.get(versionId!);
    const climbs = await db.climbs.where('versionId').equals(versionId!).toArray();
    return { version, climbs };
  }, [versionId]);

  if (!data?.version) return null;
  const { version, climbs } = data;
  const counted: HoldRole[] = include === 'all' ? ['start', 'hand', 'foot', 'finish'] : ['start', 'hand', 'finish'];
  const counts = new Map<string, number>();
  for (const c of climbs) for (const h of c.holds) if (counted.includes(h.role)) counts.set(h.holdId, (counts.get(h.holdId) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  const unused = version.holds.filter((h) => !counts.get(h.id)).length;

  return (
    <div className="editor">
      <PageHeader title={`Heatmap · photo v${version.number}`} back>
        <select value={include} onChange={(e) => setInclude(e.target.value as Include)} aria-label="Holds to count">
          <option value="all">All uses</option>
          <option value="hands">Hands only</option>
        </select>
      </PageHeader>
      <WallCanvas image={blobUrl(version.image)} width={version.width} height={version.height} imageStyle={{ filter: 'grayscale(0.7) brightness(0.8)' }}>
        {version.holds.map((h) => {
          const n = counts.get(h.id) ?? 0;
          if (!n) return <HoldOutline key={h.id} shape={h.shape} color="rgba(255,255,255,0.7)" width={1.5} strokeDasharray="4 3" halo={false} />;
          const color = heatColor(n / max);
          return <path key={h.id} d={shapePath(h.shape)} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
        })}
      </WallCanvas>
      <div className="toolbar heat-legend">
        <span>{climbs.length} climbs · {unused} of {version.holds.length} holds unused (dashed)</span>
        <span className="heat-scale">
          1 <i style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} /> {max}
        </span>
      </div>
    </div>
  );
}

/** Blue (rare) → yellow → red (most used). */
function heatColor(t: number) {
  const hue = 220 - 220 * Math.min(1, Math.max(0, t));
  return `hsl(${hue}, 90%, 55%)`;
}
