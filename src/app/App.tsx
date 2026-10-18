import { deferView } from "../components/DeferredView.tsx";
import { registerScrollOwner } from "../lib/surface-dom.ts";
import { SidebarProvider, SidebarTrigger } from "../components/ui/sidebar.tsx";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../components/ui/resizable.tsx";
import { NavigationProtection } from "../lib/navigation-protection.tsx";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "../components/ui/empty.tsx";
import { Button } from "../components/ui/button.tsx";
import { NavigationPreviewProvider } from "../features/settings/navigation-preview.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { WriteOutcomeNotice } from "../components/WriteOutcomeNotice.tsx";
import { DetailNavigationProvider } from "../lib/detail-exploration.tsx";
// 앱 조립: 경로·메뉴·브랜드. 새 도메인은 메뉴와 경로를 여기서 바꾼다.
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  type Location,
  Link,
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
import { DisplayScaleProvider } from "../features/settings/display-scale.tsx";
import { LogoutPage } from "../features/auth/LogoutPage.tsx";
import { ConsentPage } from "../features/auth/ConsentPage.tsx";
import { AuthProvider, RequireAuth, useAuth } from "../features/auth/AuthProvider.tsx";
import { LoginPage } from "../features/auth/LoginPage.tsx";
import { RecordDetailPage } from "../features/activity/RecordDetailPage.tsx";
import { RecordsPage } from "../features/activity/RecordsPage.tsx";
import { TaskDetailPage } from "../features/activity/TaskDetailPage.tsx";
import { TasksPage } from "../features/activity/TasksPage.tsx";
import { TagsPage } from "../features/tags/TagsPage.tsx";
import { SearchPage } from "../features/search/SearchPage.tsx";
import { EntitiesPage } from "../features/entity/EntitiesPage.tsx";
import { EntityDetailPage } from "../features/entity/EntityDetailPage.tsx";

const DataModelSettings = deferView<object>(
  () => import("../features/settings/DataModelSettings.tsx").then(module => ({ default: module.DataModelSettings })),
  "전체 모델 설정",
);
const RelationSettingsPage = deferView<object>(
  () => import("../features/settings/RelationSettingsPage.tsx").then(module => ({ default: module.RelationSettingsPage })),
  "관계 설정",
);
const IssuerSettingsPage = deferView<object>(
  () => import("../features/settings/IssuerSettingsPage.tsx").then(module => ({ default: module.IssuerSettingsPage })),
  "발급처 설정",
);
const RecordSettingsPage = deferView<object>(
  () => import("../features/settings/RecordSettingsPage.tsx").then(module => ({ default: module.RecordSettingsPage })),
  "기록 설정",
);
const EntityTypeSettings = deferView<object>(
  () => import("../features/settings/EntityTypeSettings.tsx").then(module => ({ default: module.EntityTypeSettings })),
  "자료 설정",
);
const GuidePage = deferView<object>(
  () => import("../features/settings/GuidePage.tsx").then(module => ({ default: module.GuidePage })),
  "사용 가이드",
);
const SettingsPage = deferView<object>(
  () => import("../features/settings/SettingsPage.tsx").then(module => ({ default: module.SettingsPage })),
  "기본 설정",
);
const TagSettingsPage = deferView<object>(
  () => import("../features/tags/TagSettingsPage.tsx").then(module => ({ default: module.TagSettingsPage })),
  "태그 설정",
);
export const APP_NAME = "Workspace";
const LazyStatusPage = lazy(() => import("../features/status/StatusPage.tsx").then(module => ({ default: module.StatusPage })));
function StatusPage() { return <Suspense fallback={<div role="status" className="flex items-center gap-2"><Spinner />상태를 불러오는 중…</div>}><LazyStatusPage /></Suspense>; }

function Layout() {
  const { session } = useAuth();
  const location = useLocation();
  const navigation = useNavigationResize(session?.user.id ?? null);
  const constraintSize = (pixels: number) => navigation.axisSize
    ? `${100 * pixels / navigation.axisSize}%`
    : `${pixels}px`;
  const scrollRegistration = useRef<(() => void) | null>(null);
  const attachMain = useCallback((node: HTMLElement | null) => {
    scrollRegistration.current?.();
    scrollRegistration.current = node ? registerScrollOwner(node, () => true) : null;
  }, []);
  return <SidebarProvider key={location.pathname === "/logout" ? "logout" : session?.user.id ?? "signed-out"} className="h-dvh min-h-0 w-full overflow-hidden" style={{ "--sidebar-width": "100%" } as React.CSSProperties}>
    <span ref={navigation.remProbe} aria-hidden="true" className="pointer-events-none absolute h-0 w-[1rem] overflow-hidden" />
    <ResizablePanelGroup elementRef={navigation.group} orientation="horizontal" className="min-h-0 min-w-0 flex-1" resizeTargetMinimumSize={{ coarse: 44, fine: 44 }}>
      <ResizablePanel id="navigation" panelRef={navigation.panel} minSize={session && navigation.desktop ? constraintSize(13 * navigation.rem) : 0} maxSize={session && navigation.desktop ? constraintSize(20 * navigation.rem) : 0} defaultSize={session && navigation.desktop ? constraintSize(13 * navigation.rem) : 0} onResize={size => navigation.remember(size.inPixels)}>
        {session && <Navigation brand={APP_NAME} />}
      </ResizablePanel>
      {session && navigation.desktop && <ResizableHandle elementRef={navigation.separator} aria-label="탐색 메뉴 너비 조절" onPointerDownCapture={navigation.beginResize} onKeyDownCapture={navigation.beginResize} onDoubleClick={navigation.reset} className="w-2 shrink-0" />}
      <ResizablePanel id="application" minSize={session && navigation.desktop ? constraintSize(navigation.applicationMinimum) : 0} className="min-w-0">
        <div className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4">
            {session && !navigation.desktop && <SidebarTrigger aria-label="주 메뉴 열기" />}
            <span className="font-medium">{APP_NAME}</span>
          </header>
          <main ref={attachMain} className="min-h-0 min-w-0 flex-1 overflow-y-auto" key={location.pathname === "/logout" ? "logout" : session?.user.id ?? "signed-out"}>
            {session && <WriteOutcomeNotice />}
            <DetailNavigationProvider key={location.pathname === "/logout" ? "logout" : session?.user.id ?? "signed-out"} scope={session?.user.id ?? "signed-out"}>
              <NavigationProtection><DetailWorkspace enabled={!!session} render={location => <WorkspaceRoutes location={location} />}><Outlet /></DetailWorkspace></NavigationProtection>
            </DetailNavigationProvider>
          </main>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </SidebarProvider>;
}

const guarded = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;
const workspaceRoutes = [
  { path: "entities", element: <EntitiesPage /> },
  { path: "entities/:id", element: <EntityDetailPage /> },
  { path: "tasks", element: <TasksPage /> },
  { path: "tasks/:id", element: <TaskDetailPage /> },
  { path: "records", element: <RecordsPage /> },
  { path: "records/:id", element: <RecordDetailPage /> },
  { path: "search", element: <SearchPage /> },
  { path: "status", element: <StatusPage /> },
];

const baseRoutes = [
  ...workspaceRoutes,
  { path: "tags", element: <TagsPage /> },
  { path: "tags/:scope", element: <TagsPage /> },
  { path: "tags/:scope/:id", element: <TagsPage /> },
  { path: "guide", element: <GuidePage /> },
  { path: "settings/navigation", element: <Navigate to="/settings#settings-navigation" replace /> },
  { path: "settings/data-model", element: <DataModelSettings /> },
  { path: "settings/relations", element: <RelationSettingsPage /> },
  { path: "settings/issuers", element: <IssuerSettingsPage /> },
  { path: "settings/records", element: <RecordSettingsPage /> },
  { path: "settings", element: <SettingsPage /> },
  { path: "settings/tags", element: <TagSettingsPage /> },
  { path: "settings/entity-identity", element: <Navigate to="/settings/issuers" replace /> },
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
      {baseRoutes.map((route) => <Route key={route.path} {...route} />)}
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
          {baseRoutes.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={guarded(route.element)}
            />
          ))}
          {materialSettingsRoutes.map((path) => (
            <Route key={path} path={path} element={guarded(<EntityTypeSettings />)} />
          ))}
          <Route path="*" element={<Empty aria-labelledby="not-found-title"><EmptyHeader><EmptyTitle><h1 id="not-found-title">페이지를 찾을 수 없습니다</h1></EmptyTitle><EmptyDescription>주소를 확인하거나 할 일 화면으로 돌아가세요.</EmptyDescription></EmptyHeader><EmptyContent><Button asChild><Link to="/tasks">할 일로 이동</Link></Button></EmptyContent></Empty>} />
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
