import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { db, latestVersion } from '../db';
import { blobUrl } from '../lib/image';

export function WallsPage() {
  const walls = useLiveQuery(async () => {
    const walls = await db.walls.orderBy('createdAt').toArray();
    return Promise.all(
      walls.map(async (wall) => ({
        wall,
        cover: await latestVersion(wall.id),
        climbCount: await db.climbs.where('wallId').equals(wall.id).count(),
      })),
    );
  });

  return (
    <>
      <PageHeader title="Walls" large>
        <Link className="btn primary" to="/walls/new">
          <Icon name="plus" size={18} /> New wall
        </Link>
      </PageHeader>
      <div className="page-body">
        {walls?.length === 0 && (
          <div className="empty">
            <Icon name="wall" size={40} />
            <h2>Add your wall</h2>
            <p>Take a photo straight on, in good light, with the whole wall in frame.</p>
            <Link className="btn primary" to="/walls/new">Add your wall</Link>
          </div>
        )}
        <ul className="wall-grid">
          {walls?.map(({ wall, cover, climbCount }) => (
            <li key={wall.id}>
              <Link to={`/walls/${wall.id}`} className="wall-card">
                {cover && <img src={blobUrl(cover.image)} alt="" />}
                <div className="wall-card-text">
                  <strong>{wall.name}</strong>
                  <span>
                    {climbCount} {climbCount === 1 ? 'climb' : 'climbs'}
                    {cover && cover.number > 1 && ` · photo v${cover.number}`}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
