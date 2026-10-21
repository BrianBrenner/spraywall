import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { db, newId } from '../db';
import { saveList } from '../lib/mutations';
import { usePermissions } from '../lib/permissions';

export function ListsPage() {
  const lists = useLiveQuery(() => db.lists.orderBy('createdAt').toArray());
  const [name, setName] = useState('');
  const { isOwner } = usePermissions();

  const create = async () => {
    if (!name.trim()) return;
    await saveList({ id: newId(), name: name.trim(), climbIds: [], createdAt: Date.now() }).catch((e) => alert(e.message));
    setName('');
  };

  return (
    <>
      <PageHeader title="Lists" large />
      <div className="page-body">
        {isOwner && (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input placeholder="New list, e.g. Warm-ups" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn primary" disabled={!name.trim()}>Create</button>
          </form>
        )}
        {lists?.length === 0 && <p className="empty">{isOwner ? 'No lists yet. Add climbs to a list from the climb view.' : 'No lists yet.'}</p>}
        {!!lists?.length && (
          <ul className="group">
            {lists.map((l) => (
              <li key={l.id}>
                <Link to={`/lists/${l.id}`} className="group-row link">
                  <span className="group-row-main">{l.name}</span>
                  <span className="muted">{l.climbIds.length} {l.climbIds.length === 1 ? 'climb' : 'climbs'}</span>
                  <Icon name="back" size={18} className="icon chevron" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
