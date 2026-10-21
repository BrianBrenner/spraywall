import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ClimbRow, PageHeader } from '../components/ui';
import { db } from '../db';
import { setClimbQueue, useCatalog } from '../lib/hooks';

export function ListPage() {
  const { listId } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const data = useLiveQuery(async () => {
    const list = await db.lists.get(listId!);
    if (!list) return null;
    const climbs = await db.climbs.bulkGet(list.climbIds);
    const walls = new Map((await db.walls.toArray()).map((w) => [w.id, w.name]));
    return { list, climbs: climbs.filter((c) => !!c), walls };
  }, [listId]);

  if (data === undefined || !catalog) return null;
  if (!data) return <div className="empty">List not found. <Link to="/lists">Back to lists</Link></div>;
  const { list, climbs, walls } = data;
  const multiWall = new Set(climbs.map((c) => c.wallId)).size > 1;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.climbIds.length) return;
    const ids = [...list.climbIds];
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    db.lists.update(list.id, { climbIds: ids });
  };

  const open = (index: number) => {
    setClimbQueue(climbs.map((c) => c.id));
    navigate(`/climbs/${climbs[index].id}`);
  };

  const rename = async () => {
    const name = prompt('List name', list.name);
    if (name?.trim()) await db.lists.update(list.id, { name: name.trim() });
  };

  const remove = async () => {
    if (!confirm(`Delete list "${list.name}"? The climbs themselves are kept.`)) return;
    await db.lists.delete(list.id);
    navigate('/lists', { replace: true });
  };

  return (
    <>
      <PageHeader title={<button type="button" className="title-btn" onClick={rename}>{list.name}</button>} back="/lists">
        {climbs.length > 0 && (
          <button type="button" className="btn primary" onClick={() => open(0)}>
            <Icon name="play" size={16} /> Climb through
          </button>
        )}
      </PageHeader>
      <div className="page-body">
        {climbs.length === 0 && <p className="empty">Open a climb and tap “Lists” to add it here.</p>}
        <ul className="climb-list">
          {climbs.map((c, i) => (
            <ClimbRow key={c.id} climb={c} catalog={catalog} versionLabel={multiWall ? walls.get(c.wallId) : undefined} onOpen={() => open(i)}>
              <div className="row-actions vertical">
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <Icon name="up" size={18} />
                </button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={i === climbs.length - 1} onClick={() => move(i, i + 1)}>
                  <Icon name="down" size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove from list"
                  onClick={() => db.lists.update(list.id, { climbIds: list.climbIds.filter((id) => id !== c.id) })}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            </ClimbRow>
          ))}
        </ul>
        <div className="page-footer">
          <button type="button" className="btn ghost danger" onClick={remove}>
            <Icon name="trash" size={16} /> Delete list
          </button>
        </div>
      </div>
    </>
  );
}
