import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { RangeSlider } from '../components/RangeSlider';
import { ClimbRow, PageHeader, SignInPrompt } from '../components/ui';
import { db } from '../db';
import { removeVersion, removeWall as removeWallEverywhere, saveWall } from '../lib/mutations';
import { usePermissions } from '../lib/permissions';
import { useTickStats } from '../lib/ticks';
import { gradeIndex, setClimbQueue, useCatalog, useStoredState } from '../lib/hooks';
import type { Climb } from '../types';

interface Filters {
  search: string;
  gradeSystemId: string;
  minGrade: string;
  maxGrade: string;
  footRuleId: string;
  tagIds: string[];
  benchmarksOnly: boolean;
  ticked: 'any' | 'yes' | 'no';
  setter: string;
  sort: 'grade' | 'newest' | 'oldest' | 'name' | 'rating' | 'popular';
}

const SORTS: { value: Filters['sort']; label: string; server?: boolean }[] = [
  { value: 'grade', label: 'Grade' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name' },
  { value: 'rating', label: 'Best rated', server: true },
  { value: 'popular', label: 'Most ticked', server: true },
];

const DEFAULT_FILTERS: Filters = {
  search: '',
  gradeSystemId: '',
  minGrade: '',
  maxGrade: '',
  footRuleId: '',
  tagIds: [],
  benchmarksOnly: false,
  ticked: 'any',
  setter: '',
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
  const perms = usePermissions();
  const stats = useTickStats((id) => catalog?.gradeSystem(id));

  const current = versions?.[versions.length - 1];
  const gradeSystemId = filters.gradeSystemId || catalog?.defaultGradeSystemId || '';
  const system = catalog?.gradeSystem(gradeSystemId);
  const gradeLo = system && filters.minGrade ? Math.max(0, system.grades.indexOf(filters.minGrade)) : 0;
  const gradeHi = system && filters.maxGrade && system.grades.includes(filters.maxGrade) ? system.grades.indexOf(filters.maxGrade) : (system?.grades.length ?? 1) - 1;

  const visible = useMemo(() => {
    if (!climbs || !catalog || !current) return [];
    const q = filters.search.trim().toLowerCase();
    const lo = filters.minGrade ? gradeIndex(system, filters.minGrade) : -1;
    const hi = filters.maxGrade ? gradeIndex(system, filters.maxGrade) : Infinity;
    // Every climb on the wall shows, whichever photo it was set on (holds only get added, never moved).
    const out = climbs.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.notes.toLowerCase().includes(q)) return false;
      if (filters.minGrade || filters.maxGrade) {
        if (c.gradeSystemId !== gradeSystemId) return false;
        const i = gradeIndex(system, c.grade);
        if (i < lo || i > hi) return false;
      }
      if (filters.footRuleId && c.footRuleId !== filters.footRuleId) return false;
      if (filters.tagIds.length && !filters.tagIds.every((t) => c.tagIds.includes(t))) return false;
      if (filters.benchmarksOnly && !c.benchmark) return false;
      if (filters.setter && c.createdBy !== filters.setter) return false;
      if (filters.ticked !== 'any' && perms.signedIn && !!stats(c).mine !== (filters.ticked === 'yes')) return false;
      return true;
    });
    const byGrade = (a: Climb, b: Climb) =>
      gradeIndex(catalog.gradeSystem(a.gradeSystemId), a.grade) - gradeIndex(catalog.gradeSystem(b.gradeSystemId), b.grade);
    const sorters: Record<Filters['sort'], (a: Climb, b: Climb) => number> = {
      grade: (a, b) => byGrade(a, b) || a.name.localeCompare(b.name),
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name),
      rating: (a, b) => stats(b).stars - stats(a).stars || byGrade(a, b),
      popular: (a, b) => stats(b).count - stats(a).count || byGrade(a, b),
    };
    return out.sort(sorters[filters.sort]);
    // stats is rebuilt each render from live ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [climbs, catalog, current, filters, system, gradeSystemId, stats]);

  if (wall === undefined && versions === undefined) return null;
  if (!wall) return <div className="empty">Wall not found. <Link to="/">Back to walls</Link></div>;
  if (!catalog || !versions || !climbs) return null;

  const activeFilterCount =
    (filters.search ? 1 : 0) + (filters.minGrade || filters.maxGrade ? 1 : 0) + (filters.footRuleId ? 1 : 0) +
    filters.tagIds.length + (filters.benchmarksOnly ? 1 : 0) +
    (filters.setter ? 1 : 0) + (filters.ticked !== 'any' && perms.signedIn ? 1 : 0);
  const setters = [...new Map(climbs.filter((c) => c.createdBy).map((c) => [c.createdBy!, c.setterName || 'Someone'])).entries()];

  const rename = async () => {
    const name = prompt('Wall name', wall.name);
    if (name?.trim()) await saveWall({ ...wall, name: name.trim() }).catch((e) => alert(e.message));
  };

  const removeWall = async () => {
    if (!confirm(`Delete "${wall.name}" and all ${climbs.length} of its climbs? This can't be undone.`)) return;
    try {
      await removeWallEverywhere(wall.id);
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    navigate('/', { replace: true });
  };

  const open = (climb: Climb) => {
    setClimbQueue(visible.map((c) => c.id));
    navigate(`/climbs/${climb.id}`);
  };

  return (
    <>
      <PageHeader title={perms.isOwner ? <button type="button" className="title-btn" onClick={rename}>{wall.name}</button> : wall.name} back="/">
        {current && perms.canSet && (
          <Link className="btn primary" to={`/climbs/new?version=${current.id}`}>
            <Icon name="plus" size={18} /> New climb
          </Link>
        )}
      </PageHeader>
      <div className="page-body">
        {perms.server && !perms.signedIn && <SignInPrompt what="set climbs and tick the ones you send" />}
        {current && current.holds.length === 0 && perms.isOwner && (
          <div className="notice">
            No holds outlined on this photo yet. <Link to={`/versions/${current.id}/holds`}>Outline holds</Link>
          </div>
        )}

        <div className="wall-actions">
          <button type="button" className={`pill ${showFilters || activeFilterCount ? 'on' : ''}`} onClick={() => setShowFilters((s) => !s)}>
            <Icon name="filter" size={16} /> Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
          <label className="pill pill-select">
            <Icon name="sort" size={16} />
            <span className="sr-only">Sort by</span>
            <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}>
              {SORTS.filter((s) => !s.server || perms.server).map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          {current && perms.isOwner && (
            <Link className="pill" to={`/versions/${current.id}/holds`}>
              <Icon name="edit" size={16} /> Holds
            </Link>
          )}
          {current && (
            <Link className="pill" to={`/versions/${current.id}/heatmap`}>
              <Icon name="heat" size={16} /> Heatmap
            </Link>
          )}
          {perms.isOwner && (
            <button type="button" className={`pill ${showPhotos ? 'on' : ''}`} onClick={() => setShowPhotos((s) => !s)}>
              <Icon name="image" size={16} /> Photos · {versions.length}
            </button>
          )}
        </div>

        {showPhotos && perms.isOwner && (
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
                            if (confirm(n ? `Delete photo v${v.number} and its ${n} climbs?` : `Delete photo v${v.number}?`)) await removeVersion(v.id).catch((e) => alert(e.message));
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
            {system && system.grades.length > 1 && (
              <div className="grade-range">
                <div className="grade-range-head">
                  <span className="field-label">Grade</span>
                  <span className="grade-range-value">
                    {gradeLo === 0 && gradeHi === system.grades.length - 1
                      ? 'Any grade'
                      : `${system.grades[gradeLo]} – ${system.grades[gradeHi]}`}
                  </span>
                </div>
                <RangeSlider
                  labels={system.grades}
                  lo={gradeLo}
                  hi={gradeHi}
                  ariaLabel="Grade"
                  onChange={(lo, hi) =>
                    set({
                      // Handles at the ends mean "no limit", so new grades added later aren't excluded.
                      minGrade: lo === 0 ? '' : system.grades[lo],
                      maxGrade: hi === system.grades.length - 1 ? '' : system.grades[hi],
                    })
                  }
                />
              </div>
            )}
            <div className="row">
              <label>
                Feet
                <select value={filters.footRuleId} onChange={(e) => set({ footRuleId: e.target.value })}>
                  <option value="">Any rule</option>
                  {catalog.footRules.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
            </div>
            {perms.server && (
              <div className="row">
                {perms.signedIn && (
                  <label>
                    Your sends
                    <select value={filters.ticked} onChange={(e) => set({ ticked: e.target.value as Filters['ticked'] })}>
                      <option value="any">All climbs</option>
                      <option value="no">Not ticked yet</option>
                      <option value="yes">Ticked</option>
                    </select>
                  </label>
                )}
                <label>
                  Setter
                  <select value={filters.setter} onChange={(e) => set({ setter: e.target.value })}>
                    <option value="">Anyone</option>
                    {setters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              </div>
            )}
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
              <button type="button" className="btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                Clear filters
              </button>
            )}
          </section>
        )}

        <p className="muted small list-count">
          {visible.length === climbs.length ? `${climbs.length} ${climbs.length === 1 ? 'climb' : 'climbs'}` : `${visible.length} of ${climbs.length} climbs`}
        </p>
        {visible.length === 0 && current && current.holds.length > 0 && (
          <p className="empty">{activeFilterCount ? 'No climbs match these filters.' : 'No climbs yet. Tap “New climb” to set one.'}</p>
        )}
        <ul className="climb-list">
          {visible.map((c) => (
            <ClimbRow
              key={c.id}
              climb={c}
              catalog={catalog}
              stats={perms.server ? stats(c) : undefined}
              onOpen={() => open(c)}
            />
          ))}
        </ul>
      </div>
    </>
  );
}
