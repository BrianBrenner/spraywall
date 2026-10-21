import { HashRouter, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Icon } from './components/Icon';
import { ClimbEditorPage } from './pages/ClimbEditorPage';
import { ClimbViewPage } from './pages/ClimbViewPage';
import { HeatmapPage } from './pages/HeatmapPage';
import { HoldEditorPage } from './pages/HoldEditorPage';
import { ListPage } from './pages/ListPage';
import { ListsPage } from './pages/ListsPage';
import { NewPhotoPage } from './pages/NewPhotoPage';
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
  return (
    <div className="tab-layout">
      <main className="tab-content">
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
        <NavLink to="/settings">
          <Icon name="settings" />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
