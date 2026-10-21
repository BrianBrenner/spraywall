import { useState } from 'react';
import { HashRouter, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Icon } from './components/Icon';
import { ClimbEditorPage } from './pages/ClimbEditorPage';
import { ClimbViewPage } from './pages/ClimbViewPage';
import { HeatmapPage } from './pages/HeatmapPage';
import { HoldEditorPage } from './pages/HoldEditorPage';
import { ListPage } from './pages/ListPage';
import { ListsPage } from './pages/ListsPage';
import { NewPhotoPage } from './pages/NewPhotoPage';
import { ProfilePage } from './pages/ProfilePage';
import { pull, useSyncError } from './lib/mutations';
import { usePermissions } from './lib/permissions';
import { SettingsPage } from './pages/SettingsPage';
import { WallPage } from './pages/WallPage';
import { WallsPage } from './pages/WallsPage';

// Hash routing keeps deep links working from a static host and inside Capacitor.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<TabLayout />}>
          <Route path="/" element={<WallsPage />} />
          <Route path="/walls/:wallId" element={<WallPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/lists/:listId" element={<ListPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        {/* Full-screen tools without the tab bar. */}
        <Route path="/walls/new" element={<NewPhotoPage />} />
        <Route path="/walls/:wallId/photo" element={<NewPhotoPage />} />
        <Route path="/versions/:versionId/holds" element={<HoldEditorPage />} />
        <Route path="/versions/:versionId/heatmap" element={<HeatmapPage />} />
        <Route path="/climbs/new" element={<ClimbEditorPage />} />
        <Route path="/climbs/:climbId/edit" element={<ClimbEditorPage />} />
        <Route path="/climbs/:climbId" element={<ClimbViewPage />} />
      </Routes>
    </HashRouter>
  );
}

function TabLayout() {
  const { server, isOwner } = usePermissions();
  return (
    <div className="tab-layout">
      <main className="tab-content">
        <SyncBanner />
        <Outlet />
      </main>
      <nav className="tab-bar">
        <NavLink to="/" end>
          <Icon name="wall" />
          Walls
        </NavLink>
        <NavLink to="/lists">
          <Icon name="bookmark" />
          Lists
        </NavLink>
        {server && (
          <NavLink to="/profile">
            <Icon name="user" />
            Profile
          </NavLink>
        )}
        {isOwner && (
          <NavLink to="/settings">
            <Icon name="settings" />
            Settings
          </NavLink>
        )}
      </nav>
    </div>
  );
}

function SyncBanner() {
  const error = useSyncError();
  const [busy, setBusy] = useState(false);
  if (!error) return null;
  const retry = () => {
    setBusy(true);
    pull()
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return (
    <div className="sync-banner" role="alert">
      <span>
        <strong>Couldn’t load walls from the server.</strong> {error}
      </span>
      <button type="button" className="btn small" disabled={busy} onClick={retry}>
        {busy ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
