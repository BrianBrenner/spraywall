import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { db, newId, requestPersistence } from '../db';
import { useCatalog, type Catalog } from '../lib/hooks';
import { ensureThumbnails } from '../lib/thumbnail';
import { exportAll, importAll, shareOrDownload, type ImportMode } from '../lib/transfer';
import type { FootRule, GradeSystem } from '../types';

export function SettingsPage() {
  const catalog = useCatalog();
  const usage = useLiveQuery(async () => {
    const grades = new Map<string, number>();
    const rules = new Map<string, number>();
    await db.climbs.each((c) => {
      grades.set(c.gradeSystemId, (grades.get(c.gradeSystemId) ?? 0) + 1);
      rules.set(c.footRuleId, (rules.get(c.footRuleId) ?? 0) + 1);
    });
    return { grades, rules };
  });
  if (!catalog || !usage) return null;

  return (
    <>
      <PageHeader title="Settings" large />
      <div className="page-body settings">
        <FootRules catalog={catalog} usage={usage.rules} />
        <Tags catalog={catalog} />
        <GradeSystems catalog={catalog} usage={usage.grades} />
        <DataSection />
      </div>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      {children}
      {hint && <p className="section-hint">{hint}</p>}
    </section>
  );
}

function FootRules({ catalog, usage }: { catalog: Catalog; usage: Map<string, number> }) {
  const [editing, setEditing] = useState<FootRule | null>(null);

  const save = async () => {
    if (!editing?.name.trim()) return;
    await db.footRules.put({ ...editing, name: editing.name.trim(), description: editing.description.trim() });
    setEditing(null);
  };

  return (
    <Section title="Foot rules" hint="The default is used for new climbs.">
      <ul className="group">
        {catalog.footRules.map((f) =>
          editing?.id === f.id ? (
            <li key={f.id}>
              <RuleForm rule={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} />
            </li>
          ) : (
            <li key={f.id} className="group-row">
              <div className="group-row-main">
                <div>
                  {f.name}
                  {f.id === catalog.defaultFootRuleId && <span className="badge accent">Default</span>}
                </div>
                {f.description && <div className="muted small">{f.description}</div>}
              </div>
              {f.id !== catalog.defaultFootRuleId && (
                <button type="button" className="btn ghost small" onClick={() => db.settings.update('app', { defaultFootRuleId: f.id })}>
                  Make default
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
                <Icon name="edit" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`Delete ${f.name}`}
                disabled={!!usage.get(f.id) || f.id === catalog.defaultFootRuleId}
                title={usage.get(f.id) ? 'In use by climbs' : undefined}
                onClick={() => db.footRules.delete(f.id)}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ),
        )}
        {editing && !catalog.footRule(editing.id) ? (
          <li>
            <RuleForm rule={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} />
          </li>
        ) : (
          <li>
            <button type="button" className="group-row add" onClick={() => setEditing({ id: newId(), name: '', description: '' })}>
              <Icon name="plus" size={18} /> Add foot rule
            </button>
          </li>
        )}
      </ul>
    </Section>
  );
}

function RuleForm({ rule, onChange, onCancel, onSave }: { rule: FootRule; onChange: (r: FootRule) => void; onCancel: () => void; onSave: () => void }) {
  return (
    <form className="group-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <input autoFocus placeholder="Name, e.g. Feet follow hands" value={rule.name} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
      <input placeholder="Description (optional)" value={rule.description} onChange={(e) => onChange({ ...rule, description: e.target.value })} />
      <div className="row-actions end">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!rule.name.trim()}>Save</button>
      </div>
    </form>
  );
}

function Tags({ catalog }: { catalog: Catalog }) {
  const [name, setName] = useState('');
  const remove = async (id: string, tagName: string) => {
    if (!confirm(`Delete tag "${tagName}"? It will be removed from any climbs.`)) return;
    await db.transaction('rw', [db.tags, db.climbs], async () => {
      await db.tags.delete(id);
      await db.climbs.filter((c) => c.tagIds.includes(id)).modify((c) => {
        c.tagIds = c.tagIds.filter((t) => t !== id);
      });
    });
  };
  return (
    <Section title="Tags">
      <div className="card">
        <div className="chips">
          {catalog.tags.map((t) => (
            <span key={t.id} className="chip removable">
              {t.name}
              <button type="button" aria-label={`Delete ${t.name}`} onClick={() => remove(t.id, t.name)}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
        <form className="inline-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await db.tags.add({ id: newId(), name: name.trim() });
          setName('');
        }}>
          <input placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={!name.trim()}>Add</button>
        </form>
      </div>
    </Section>
  );
}

function GradeSystems({ catalog, usage }: { catalog: Catalog; usage: Map<string, number> }) {
  const [editing, setEditing] = useState<GradeSystem | null>(null);

  const save = async () => {
    if (!editing) return;
    const grades = editing.grades.map((g) => g.trim()).filter(Boolean);
    if (!editing.name.trim() || !grades.length) return;
    await db.gradeSystems.put({ ...editing, name: editing.name.trim(), grades });
    setEditing(null);
  };

  return (
    <Section title="Grades">
      <ul className="group">
        {catalog.gradeSystems.map((g) => (
          <li key={g.id} className="group-row">
            <div className="group-row-main">
              <div>
                {g.name}
                {catalog.gradeSystems.length > 1 && g.id === catalog.defaultGradeSystemId && <span className="badge accent">Default</span>}
              </div>
              <div className="muted small">
                {g.grades[0]} to {g.grades[g.grades.length - 1]} · {g.grades.length} grades · {usage.get(g.id) ?? 0} climbs
              </div>
            </div>
            {catalog.gradeSystems.length > 1 && g.id !== catalog.defaultGradeSystemId && (
              <button type="button" className="btn ghost small" onClick={() => db.settings.update('app', { defaultGradeSystemId: g.id })}>
                Make default
              </button>
            )}
            <button type="button" className="icon-btn" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
              <Icon name="edit" size={18} />
            </button>
            {catalog.gradeSystems.length > 1 && (
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`Delete ${g.name}`}
                disabled={!!usage.get(g.id) || g.id === catalog.defaultGradeSystemId}
                onClick={() => db.gradeSystems.delete(g.id)}
              >
                <Icon name="trash" size={18} />
              </button>
            )}
          </li>
        ))}
        {!editing && (
          <li>
            <button type="button" className="group-row add" onClick={() => setEditing({ id: newId(), name: '', grades: [] })}>
              <Icon name="plus" size={18} /> Add custom scale
            </button>
          </li>
        )}
      </ul>
      {editing && (
        <form className="card form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label>
            Name
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label>
            Grades, easiest first, one per line
            <textarea rows={8} value={editing.grades.join('\n')} onChange={(e) => setEditing({ ...editing, grades: e.target.value.split('\n') })} />
          </label>
          {!!usage.get(editing.id) && <p className="hint">Climbs keep their grade text if you rename or remove a grade here.</p>}
          <div className="row-actions end">
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn primary">Save</button>
          </div>
        </form>
      )}
    </Section>
  );
}

function DataSection() {
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted);
    navigator.storage?.estimate?.().then((e) => e.usage && setUsage(`${(e.usage / 1e6).toFixed(1)} MB used on this device.`));
  }, []);

  const doExport = async () => {
    setStatus('Preparing export…');
    try {
      const blob = await exportAll();
      await shareOrDownload(blob, `spraywall-${new Date().toISOString().slice(0, 10)}.zip`);
      setStatus('');
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`);
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    if (mode === 'replace' && !confirm('Replace ALL data on this device with the backup?')) return;
    setStatus('Importing…');
    try {
      const s = await importAll(file, mode);
      setStatus(`Imported ${s.walls} walls, ${s.climbs} climbs, ${s.lists} lists. Rebuilding thumbnails…`);
      await ensureThumbnails();
      setStatus(`Imported ${s.walls} walls, ${s.climbs} climbs, ${s.lists} lists.`);
    } catch (e) {
      setStatus(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <Section title="Backup & transfer">
      <div className="card stack">
        <p className="muted">
          Everything is stored on this device only. Export a backup to move to another device (AirDrop works on iPad
          and iPhone), then import it there.
        </p>
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={doExport}>
            <Icon name="upload" size={18} /> Export backup
          </button>
          <label className="file-pick">
            <span className="btn">
              <Icon name="download" size={18} /> Import…
            </span>
            <input type="file" accept=".zip,application/zip" hidden onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <select className="compact" value={mode} onChange={(e) => setMode(e.target.value as ImportMode)} aria-label="Import mode">
            <option value="merge">Merge with existing</option>
            <option value="replace">Replace everything</option>
          </select>
        </div>
        {status && <p className="status">{status}</p>}
        <p className="muted small">
          {usage}{' '}
          {persisted === true && 'Storage is protected from automatic clean-up.'}
          {persisted === false && (
            <>
              Your browser may clear this data if space runs low. Add the app to your Home Screen and export backups now
              and then.{' '}
              <button type="button" className="link-btn" onClick={async () => setPersisted(await requestPersistence())}>
                Request protected storage
              </button>
            </>
          )}
        </p>
      </div>
    </Section>
  );
}
