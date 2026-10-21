import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ClimbRow, PageHeader } from '../components/ui';
import { db, deleteVersion, deleteWall } from '../db';
import { gradeIndex, setClimbQueue, useCatalog, useStoredState } from '../lib/hooks';
import type { Climb } from '../types';

interface Filters {
  version: 'current' | 'all';
  search: string;
  gradeSystemId: string;
  minGrade: string;
  maxGrade: string;
  footRuleId: string;
  tagIds: string[];
  noMatching: 'any' | 'yes' | 'no';
  benchmarksOnly: boolean;
  sort: 'grade' | 'newest' | 'oldest' | 'name';
}

const DEFAULT_FILTERS: Filters = {
  version: 'current',
  search: '',
  gradeSystemId: '',
  minGrade: '',
  maxGrade: '',
  footRuleId: '',
  tagIds: [],
  noMatching: 'any',
  benchmarksOnly: false,
  sort: 'grade',
};

export function WallPage() {
  const { wallId } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const wall = useLiveQuery(() => db.walls.get(wallId!), [wallId]);
  const versions = useLiveQuery(() => db.versions.where('wallId').equals(wallId!).sortBy('number'), [wallId]);
  const climbs = useLiveQuery(() => db.climbs.where('wallId').equals(wallId!).toArray(), [wallId]);
  const [filters, setFilters] = useStoredState<Filters>(`filters:${wallId}`, DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const current = versions?.[versions.length - 1];
  const versionNumber = useMemo(() => new Map(versions?.map((v) => [v.id, v.number])), [versions]);
  const gradeSystemId = filters.gradeSystemId || catalog?.defaultGradeSystemId || '';
  const system = catalog?.gradeSystem(gradeSystemId);

  const visible = useMemo(() => {
    if (!climbs || !catalog || !current) return [];
    const q = filters.search.trim().toLowerCase();
    const lo = filters.minGrade ? gradeIndex(system, filters.minGrade) : -1;
    const hi = filters.maxGrade ? gradeIndex(system, filters.maxGrade) : Infinity;
    const out = climbs.filter((c) => {
      if (filters.version === 'current' && c.versionId !== current.id) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.notes.toLowerCase().includes(q)) return false;
      if (filters.minGrade || filters.maxGrade) {
        if (c.gradeSystemId !== gradeSystemId) return false;
        const i = gradeIndex(system, c.grade);
        if (i < lo || i > hi) return false;
      }
      if (filters.footRuleId && c.footRuleId !== filters.footRuleId) return false;
      if (filters.tagIds.length && !filters.tagIds.every((t) => c.tagIds.includes(t))) return false;
      if (filters.noMatching === 'yes' && !c.noMatching) return false;
      if (filters.noMatching === 'no' && c.noMatching) return false;
      if (filters.benchmarksOnly && !c.benchmark) return false;
      return true;
    });
    const byGrade = (a: Climb, b: Climb) =>
      gradeIndex(catalog.gradeSystem(a.gradeSystemId), a.grade) - gradeIndex(catalog.gradeSystem(b.gradeSystemId), b.grade);
    const sorters: Record<Filters['sort'], (a: Climb, b: Climb) => number> = {
      grade: (a, b) => byGrade(a, b) || a.name.localeCompare(b.name),
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return out.sort(sorters[filters.sort]);
  }, [climbs, catalog, current, filters, system, gradeSystemId]);

  if (wall === undefined && versions === undefined) return null;
  if (!wall) return <div className="empty">Wall not found. <Link to="/">Back to walls</Link></div>;
  if (!catalog || !versions || !climbs) return null;

  const activeFilterCount =
    (filters.search ? 1 : 0) + (filters.minGrade || filters.maxGrade ? 1 : 0) + (filters.footRuleId ? 1 : 0) +
    filters.tagIds.length + (filters.noMatching !== 'any' ? 1 : 0) + (filters.benchmarksOnly ? 1 : 0);

  const rename = async () => {
    const name = prompt('Wall name', wall.name);
    if (name?.trim()) await db.walls.update(wall.id, { name: name.trim() });
  };

  const removeWall = async () => {
    if (!confirm(`Delete "${wall.name}" and all ${climbs.length} of its climbs? This can't be undone.`)) return;
    await deleteWall(wall.id);
    navigate('/', { replace: true });
  };

  const open = (climb: Climb) => {
    setClimbQueue(visible.map((c) => c.id));
    navigate(`/climbs/${climb.id}`);
  };

  return (
    <>
      <PageHeader title={<button type="button" className="title-btn" onClick={rename}>{wall.name}</button>} back="/">
        {current && (
          <Link className="btn primary" to={`/climbs/new?version=${current.id}`}>
            <Icon name="plus" size={18} /> New climb
          </Link>
        )}
      </PageHeader>
      <div className="page-body">
        {current && current.holds.length === 0 && (
          <div className="notice">
            No holds outlined on this photo yet. <Link to={`/versions/${current.id}/holds`}>Outline holds</Link>
          </div>
        )}

        <div className="wall-actions">
          <button type="button" className={`pill ${showFilters || activeFilterCount ? 'on' : ''}`} onClick={() => setShowFilters((s) => !s)}>
            <Icon name="filter" size={16} /> Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
          {current && (
            <Link className="pill" to={`/versions/${current.id}/holds`}>
              <Icon name="edit" size={16} /> Holds
            </Link>
          )}
          {current && (
            <Link className="pill" to={`/versions/${current.id}/heatmap`}>
              <Icon name="heat" size={16} /> Heatmap
            </Link>
          )}
          <button type="button" className={`pill ${showPhotos ? 'on' : ''}`} onClick={() => setShowPhotos((s) => !s)}>
            <Icon name="image" size={16} /> Photos · {versions.length}
          </button>
        </div>

        {showPhotos && (
          <section className="panel">
            <ul className="version-list">
              {[...versions].reverse().map((v) => {
                const n = climbs.filter((c) => c.versionId === v.id).length;
                return (
                  <li key={v.id}>
                    <span>
                      <strong>Photo v{v.number}</strong>
                      {v === current && <span className="badge">current</span>}
                      <span className="muted small"> {new Date(v.createdAt).toLocaleDateString()} · {v.holds.length} holds · {n} climbs</span>
                    </span>
                    <span className="row-actions">
                      <Link className="btn small" to={`/versions/${v.id}/holds`}>Holds</Link>
                      <Link className="btn small" to={`/versions/${v.id}/heatmap`}>Heatmap</Link>
                      {versions.length > 1 && (
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={async () => {
                            if (confirm(n ? `Delete photo v${v.number} and its ${n} climbs?` : `Delete photo v${v.number}?`)) await deleteVersion(v.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="row-actions">
              <Link className="btn primary" to={`/walls/${wall.id}/photo`}>Add new photo</Link>
              <button type="button" className="btn danger" onClick={removeWall}>Delete wall</button>
            </div>
          </section>
        )}

        {showFilters && (
          <section className="panel form filters">
            <input type="search" placeholder="Search names and notes" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
            <div className="row">
              <label>
                Photos
                <select value={filters.version} onChange={(e) => set({ version: e.target.value as Filters['version'] })}>
                  <option value="current">Current photo only</option>
                  <option value="all">All photos</option>
                </select>
              </label>
              <label>
                Sort
                <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}>
                  <option value="grade">Grade</option>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            <div className="row">
              {catalog.gradeSystems.length > 1 && (
                <label>
                  Grades
                  <select value={gradeSystemId} onChange={(e) => set({ gradeSystemId: e.target.value, minGrade: '', maxGrade: '' })}>
                    {catalog.gradeSystems.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              )}
              <label>
                From
                <select value={filters.minGrade} onChange={(e) => set({ minGrade: e.target.value })}>
                  <option value="">Any</option>
                  {system?.grades.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label>
                To
                <select value={filters.maxGrade} onChange={(e) => set({ maxGrade: e.target.value })}>
                  <option value="">Any</option>
                  {system?.grades.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
            </div>
            <div className="row">
              <label>
                Feet
                <select value={filters.footRuleId} onChange={(e) => set({ footRuleId: e.target.value })}>
                  <option value="">Any rule</option>
                  {catalog.footRules.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label>
                Matching
                <select value={filters.noMatching} onChange={(e) => set({ noMatching: e.target.value as Filters['noMatching'] })}>
                  <option value="any">Any</option>
                  <option value="no">Matching allowed</option>
                  <option value="yes">No matching</option>
                </select>
              </label>
            </div>
            <div className="chips">
              <button
                type="button"
                className={`chip ${filters.benchmarksOnly ? 'on' : ''}`}
                aria-pressed={filters.benchmarksOnly}
                onClick={() => set({ benchmarksOnly: !filters.benchmarksOnly })}
              >
                <Icon name="star" size={14} fill="currentColor" /> Benchmarks
              </button>
              {catalog.tags.map((t) => {
                const on = filters.tagIds.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    className={`chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => set({ tagIds: on ? filters.tagIds.filter((id) => id !== t.id) : [...filters.tagIds, t.id] })}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            {activeFilterCount > 0 && (
              <button type="button" className="btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, version: filters.version, sort: filters.sort })}>
                Clear filters
              </button>
            )}
          </section>
        )}

        <p className="muted small list-count">
          {visible.length} of {filters.version === 'current' ? climbs.filter((c) => c.versionId === current?.id).length : climbs.length} climbs
          {filters.version === 'current' && climbs.some((c) => c.versionId !== current?.id) && (
            <> · <button type="button" className="link-btn" onClick={() => set({ version: 'all' })}>show older photos</button></>
          )}
        </p>
        {visible.length === 0 && current && current.holds.length > 0 && (
          <p className="empty">{activeFilterCount ? 'No climbs match these filters.' : 'No climbs on this photo yet. Tap “New climb” to set one.'}</p>
        )}
        <ul className="climb-list">
          {visible.map((c) => (
            <ClimbRow
              key={c.id}
              climb={c}
              catalog={catalog}
              versionLabel={c.versionId !== current?.id ? `photo v${versionNumber.get(c.versionId)}` : undefined}
              onOpen={() => open(c)}
            />
          ))}
        </ul>
      </div>
    </>
  );
}
