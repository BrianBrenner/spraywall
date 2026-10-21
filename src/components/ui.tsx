import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blobUrl } from '../lib/image';
import type { Climb } from '../types';
import type { Catalog } from '../lib/hooks';
import type { TickStats } from '../lib/ticks';
import { Icon } from './Icon';

/**
 * Top bar. `large` is for the tab roots (Walls, Lists, Settings): a big title
 * aligned with the page content. Otherwise a compact bar with a back button.
 */
export function PageHeader({ title, back, large, children }: { title: ReactNode; back?: string | true; large?: boolean; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className={`page-header ${large ? 'large' : ''}`}>
      <div className="page-header-inner">
        {back && (
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => (back === true ? navigate(-1) : navigate(back))}>
            <Icon name="back" size={24} />
          </button>
        )}
        <h1>{title}</h1>
        <div className="header-actions">{children}</div>
      </div>
    </header>
  );
}

export function ClimbThumb({ climb }: { climb: Climb }) {
  return climb.thumbnail ? (
    <img className="climb-thumb" src={blobUrl(climb.thumbnail)} alt="" />
  ) : (
    <div className="climb-thumb placeholder" />
  );
}

/**
 * Rules say how you're allowed to climb it, so they look loud (tags just describe it).
 * Compact (cards): only a foot rule that differs from the default. Full (climbing
 * view): the foot rule always, plus No matching.
 */
export function ClimbRules({ climb, catalog, full }: { climb: Climb; catalog: Catalog; full?: boolean }) {
  const rule = catalog.footRule(climb.footRuleId);
  const showRule = rule && (full || climb.footRuleId !== catalog.defaultFootRuleId);
  const items = [showRule && rule.name, full && climb.noMatching && 'No matching'].filter(Boolean) as string[];
  if (!items.length) return null;
  if (!full) return <>{items.map((t) => <span key={t} className="rule-chip">{t}</span>)}</>;
  return (
    <div className="rules-bar" aria-label="Rules">
      {items.map((t, i) => (
        <span key={t}>
          {i > 0 && <span className="rules-sep">·</span>}
          {t}
        </span>
      ))}
    </div>
  );
}

/** Benchmark star and descriptive tags. */
export function ClimbMeta({ climb, catalog }: { climb: Climb; catalog: Catalog }) {
  if (!climb.benchmark && !climb.tagIds.some((id) => catalog.tag(id))) return null;
  return (
    <div className="climb-meta">
      {climb.benchmark && (
        <span className="badge star">
          <Icon name="star" size={12} fill="currentColor" /> Benchmark
        </span>
      )}
      {climb.tagIds.map((id) => {
        const tag = catalog.tag(id);
        return tag ? <span key={id} className="badge outline">{tag.name}</span> : null;
      })}
    </div>
  );
}

export function GradeChip({ grade }: { grade: string }) {
  return <span className="grade-chip">{grade || '—'}</span>;
}

/** Your send first (what's left to do matters most), then rating, send count and consensus grade. The setter lives in Info. */
export function TickSummary({ climb, stats }: { climb: Climb; stats?: TickStats }) {
  const parts: ReactNode[] = [];
  if (stats?.mine) parts.push(<span key="mine" className="sent"><Icon name="check" size={13} /> Sent</span>);
  if (stats && stats.stars > 0) parts.push(<span key="stars" className="stars"><Icon name="star" size={12} fill="currentColor" /> {stats.stars.toFixed(1)}</span>);
  if (stats?.count) parts.push(<span key="count">{stats.count} {stats.count === 1 ? 'send' : 'sends'}</span>);
  if (stats?.consensus && stats.consensus !== climb.grade) parts.push(<span key="cons">feels {stats.consensus}</span>);
  if (!parts.length) return null;
  return (
    <div className="tick-summary">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="sep">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

export function ClimbRow({ climb, catalog, stats, versionLabel, onOpen, children }: {
  climb: Climb;
  catalog: Catalog;
  stats?: TickStats;
  versionLabel?: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="climb-row">
      <button type="button" className="climb-row-main" onClick={onOpen}>
        <ClimbThumb climb={climb} />
        <div className="climb-row-text">
          <div className="climb-row-title">
            <span className="climb-name">{climb.name || 'Untitled'}</span>
            <GradeChip grade={climb.grade} />
            <ClimbRules climb={climb} catalog={catalog} />
          </div>
          {climb.setterName && <span className="byline">Set by {climb.setterName}</span>}
          <ClimbMeta climb={climb} catalog={catalog} />
          <TickSummary climb={climb} stats={stats} />
          {versionLabel && <span className="climb-version">{versionLabel}</span>}
        </div>
      </button>
      {children}
    </li>
  );
}

/** Shown on owner-only screens to everyone else (only reachable by a pasted link). */
export function OwnerOnly() {
  return (
    <div className="page">
      <PageHeader title="Owner only" back />
      <p className="empty">Only the wall owner can do this.</p>
    </div>
  );
}

/** Explains what signing in unlocks, with a link to the Profile tab. */
export function SignInPrompt({ what }: { what: string }) {
  return (
    <p className="notice">
      <Link to="/profile">Sign in</Link> to {what}.
    </p>
  );
}
