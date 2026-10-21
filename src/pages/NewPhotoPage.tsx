import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { db, latestVersion, newId, requestPersistence } from '../db';
import { scaleShape } from '../lib/geometry';
import { prepareWallImage } from '../lib/image';

/** Create a wall from a photo, or add a new photo (version) to an existing wall. */
export function NewPhotoPage() {
  const { wallId } = useParams();
  const navigate = useNavigate();
  const wall = useLiveQuery(() => (wallId ? db.walls.get(wallId) : undefined), [wallId]);
  const previous = useLiveQuery(() => (wallId ? latestVersion(wallId) : undefined), [wallId]);

  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<{ image: Blob; width: number; height: number; url: string } | null>(null);
  const [copyHolds, setCopyHolds] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const prepared = await prepareWallImage(file);
      setPhoto({ ...prepared, url: URL.createObjectURL(prepared.image) });
    } catch {
      setError("Couldn't read that image. Try a JPEG or PNG.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!photo) return;
    setBusy(true);
    const id = wallId ?? newId();
    const now = Date.now();
    // Copied holds keep their ids, so a hold is recognisably "the same hold" across photos.
    const holds =
      previous && copyHolds
        ? previous.holds.map((h) => ({
            ...h,
            shape: scaleShape(h.shape, photo.width / previous.width, photo.height / previous.height),
          }))
        : [];
    const versionId = newId();
    await db.transaction('rw', [db.walls, db.versions], async () => {
      if (!wallId) await db.walls.add({ id, name: name.trim() || 'My wall', createdAt: now });
      await db.versions.add({
        id: versionId,
        wallId: id,
        number: (previous?.number ?? 0) + 1,
        image: photo.image,
        width: photo.width,
        height: photo.height,
        holds,
        createdAt: now,
      });
    });
    requestPersistence();
    navigate(`/versions/${versionId}/holds`, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader title={wallId ? `New photo · ${wall?.name ?? ''}` : 'New wall'} back />
      <div className="form narrow">
        {!wallId && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Garage wall" />
          </label>
        )}
        {wallId && (
          <p className="hint">
            Climbs already set stay on their original photo. New climbs use this one.
          </p>
        )}
        <label className="file-pick">
          <span className="btn">{photo ? 'Choose a different photo' : 'Choose or take a photo'}</span>
          <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} hidden />
        </label>
        {busy && !photo && <p className="hint">Processing photo…</p>}
        {error && <p className="error">{error}</p>}
        {photo && <img className="photo-preview" src={photo.url} alt="Wall preview" />}
        {previous && previous.holds.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={copyHolds} onChange={(e) => setCopyHolds(e.target.checked)} />
            Copy the {previous.holds.length} hold outlines from photo v{previous.number}, then adjust what moved
          </label>
        )}
        <button type="button" className="btn primary" disabled={!photo || busy} onClick={save}>
          Next: outline holds
        </button>
      </div>
    </div>
  );
}
