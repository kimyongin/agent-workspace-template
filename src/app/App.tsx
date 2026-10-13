import { NavigationPreviewProvider } from "../features/settings/navigation-preview.tsx";
import { NavigationSettingsPage } from "../features/settings/NavigationSettingsPage.tsx";
import { EntityTypeSettings } from "../features/settings/EntityTypeSettings.tsx";
import { StatusPage } from "../features/status/StatusPage.tsx";
import { WriteOutcomeNotice } from "../components/WriteOutcomeNotice.tsx";
import { DetailNavigationProvider } from "../lib/detail-exploration.tsx";
// 앱 조립: 경로·메뉴·브랜드. 새 도메인은 메뉴와 경로를 여기서 바꾼다.
import { useState } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  type Location,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router";
import { DetailWorkspace } from "../features/details/DetailWorkspace.tsx";
import { Navigation } from "./Navigation.tsx";
import { useNavigationResize } from "./useNavigationResize.ts";
import { GuidePage } from "../features/settings/GuidePage.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { DisplayScaleProvider } from "../features/settings/display-scale.tsx";
import { LogoutPage } from "../features/auth/LogoutPage.tsx";
import { ConsentPage } from "../features/auth/ConsentPage.tsx";
import { AuthProvider, RequireAuth, useAuth } from "../features/auth/AuthProvider.tsx";
import { LoginPage } from "../features/auth/LoginPage.tsx";
import { RecordDetailPage } from "../features/activity/RecordDetailPage.tsx";
import { RecordsPage } from "../features/activity/RecordsPage.tsx";
import { TaskDetailPage } from "../features/activity/TaskDetailPage.tsx";
import { TasksPage } from "../features/activity/TasksPage.tsx";
import { PrinciplesPage } from "../features/principles/PrinciplesPage.tsx";
import { PrincipleDetailPage } from "../features/principles/PrincipleDetailPage.tsx";
import { TagsPage } from "../features/tags/TagsPage.tsx";
import { SearchPage } from "../features/search/SearchPage.tsx";
import { EntitiesPage } from "../features/entity/EntitiesPage.tsx";
import { EntityDetailPage } from "../features/entity/EntityDetailPage.tsx";

export const APP_NAME = "Workspace";

function Layout() {
  const { session } = useAuth();
  const location = useLocation();
  const navigation = useNavigationResize(session?.user.id ?? null);
  return (
    <div
      style={navigation.style}
      className={`app-shell${session ? " has-navigation" : ""}${navigation.dragging ? " is-resizing" : ""}`}
    >
      <header className={`app-header${session ? " workspace-header" : ""}`}>
        <span className="app-brand">{APP_NAME}</span>
      </header>
      <main className="app-main" key={location.pathname === "/logout" ? "logout" : session?.user.id ?? "signed-out"}>
        {session && <WriteOutcomeNotice />}
        <DetailNavigationProvider
          key={location.pathname === "/logout" ? "logout" : session?.user.id ?? "signed-out"}
          scope={session?.user.id ?? "signed-out"}
        >
          <DetailWorkspace enabled={!!session} render={(location) => <WorkspaceRoutes location={location} />}>
            <Outlet />
          </DetailWorkspace>
        </DetailNavigationProvider>
      </main>
      {session && <Navigation brand={APP_NAME} navigationRef={navigation.ref} />}
      <div className="pane-resize-handle navigation-resize-handle" {...navigation.separator} />
    </div>
  );
}

const guarded = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;
const workspaceRoutes = [
  { path: "entities", element: <EntitiesPage /> },
  { path: "entities/:id", element: <EntityDetailPage /> },
  { path: "tasks", element: <TasksPage /> },
  { path: "tasks/:id", element: <TaskDetailPage /> },
  { path: "records", element: <RecordsPage /> },
  { path: "records/:id", element: <RecordDetailPage /> },
  { path: "principles", element: <PrinciplesPage /> },
  { path: "principles/:id", element: <PrincipleDetailPage /> },
  { path: "search", element: <SearchPage /> },
  { path: "status", element: <StatusPage /> },
];

const materialSettingsRoutes = [
  "settings/entity-types",
  "settings/entity-types/:type_id",
  "settings/entity-types/:type_id/versions",
  "settings/entity-types/:type_id/migrations",
  "settings/entity-types/:type_id/migrations/:job_id",
  "settings/materials",
  "settings/materials/:type_id",
  "settings/materials/:type_id/versions",
  "settings/materials/:type_id/migrations",
  "settings/materials/:type_id/migrations/:job_id",
];
function WorkspaceRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      {workspaceRoutes.map((route) => <Route key={route.path} {...route} />)}
      {materialSettingsRoutes.map((path) => <Route key={path} path={path} element={<EntityTypeSettings />} />)}
    </Routes>
  );
}

export function App() {
  // Data router는 기존 URL을 유지하고 편집 초안의 useBlocker 경로를 지원한다.
  const [router] = useState(() =>
    createBrowserRouter(
      createRoutesFromElements(
        <Route path="/*" element={<Layout />}>
          <Route index element={<Navigate to="/tasks" replace />} />
          <Route path="login" element={<LoginPage />} />
          {/* 세션 해제 뒤 next=/logout으로 재로그인하는 루프를 만들지 않는다. */}
          <Route path="logout" element={<LogoutPage />} />
          <Route path="oauth/consent" element={guarded(<ConsentPage />)} />
          {workspaceRoutes.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={guarded(route.element)}
            />
          ))}
          <Route path="tags" element={guarded(<TagsPage />)} />
          <Route path="tags/:scope" element={guarded(<TagsPage />)} />
          <Route path="tags/:scope/:id" element={guarded(<TagsPage />)} />
          <Route path="guide" element={guarded(<GuidePage />)} />
          <Route path="settings/navigation" element={guarded(<NavigationSettingsPage />)} />
          <Route path="settings" element={guarded(<SettingsPage />)} />
          <Route
            path="settings/entity-identity"
            element={guarded(<Navigate to="/settings#entity-identity-title" replace />)}
          />
          {materialSettingsRoutes.map((path) => (
            <Route key={path} path={path} element={guarded(<EntityTypeSettings />)} />
          ))}
          <Route path="*" element={<p className="secondary">페이지를 찾을 수 없습니다.</p>} />
        </Route>,
      ),
      { basename: import.meta.env.BASE_URL.replace(/\/$/, "") },
    )
  );
  return (
    <AuthProvider>
      <DisplayScaleProvider>
        <NavigationPreviewProvider>
          <RouterProvider router={router} />
        </NavigationPreviewProvider>
      </DisplayScaleProvider>
    </AuthProvider>
  );
}
