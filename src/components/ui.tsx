import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { blobUrl } from '../lib/image';
import type { Climb } from '../types';
import type { Catalog } from '../lib/hooks';
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

export function ClimbMeta({ climb, catalog }: { climb: Climb; catalog: Catalog }) {
  const rule = catalog.footRule(climb.footRuleId);
  return (
    <div className="climb-meta">
      {climb.benchmark && (
        <span className="badge star">
          <Icon name="star" size={12} fill="currentColor" /> Benchmark
        </span>
      )}
      {rule && <span className="badge">{rule.name}</span>}
      {climb.noMatching && <span className="badge warn">No matching</span>}
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

export function ClimbRow({ climb, catalog, versionLabel, onOpen, children }: {
  climb: Climb;
  catalog: Catalog;
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
          </div>
          <ClimbMeta climb={climb} catalog={catalog} />
          {versionLabel && <span className="climb-version">{versionLabel}</span>}
        </div>
      </button>
      {children}
    </li>
  );
}
