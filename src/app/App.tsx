// 앱 조립: 경로·메뉴·브랜드. 새 도메인은 메뉴와 경로를 여기서 바꾼다.
import { useState } from "react";
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider, useLocation } from "react-router";
import { Navigation } from "./Navigation.tsx";
import { GuidePage } from "../features/settings/GuidePage.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
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
  return (
    <div className={`app-shell${session ? " has-navigation" : ""}`}>
      {!session && <header className="app-header">
        <span className="app-brand">{APP_NAME}</span>
      </header>}
      <main className="app-main" key={location.pathname === "/logout" ? "logout" : session?.user.id ?? "signed-out"}>
        <Outlet />
      </main>
      {session && <Navigation />}
    </div>
  );
}

const guarded = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;

export function App() {
  // Data router는 기존 URL을 유지하고 편집 초안의 useBlocker 경로를 지원한다.
  const [router] = useState(() => createBrowserRouter(createRoutesFromElements(
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/tasks" replace />} />
            <Route path="login" element={<LoginPage />} />
            {/* 세션 해제 뒤 next=/logout으로 재로그인하는 루프를 만들지 않는다. */}
            <Route path="logout" element={<LogoutPage />} />
            <Route path="oauth/consent" element={guarded(<ConsentPage />)} />
            <Route path="tasks" element={guarded(<TasksPage />)} />
            <Route path="tasks/:id" element={guarded(<TaskDetailPage />)} />
            <Route path="records" element={guarded(<RecordsPage />)} />
            <Route path="records/:id" element={guarded(<RecordDetailPage />)} />
            <Route path="principles" element={guarded(<PrinciplesPage />)} />
            <Route path="principles/:id" element={guarded(<PrincipleDetailPage />)} />
            <Route path="tags" element={guarded(<TagsPage />)} />
            <Route path="tags/:scope" element={guarded(<TagsPage />)} />
            <Route path="tags/:scope/:id" element={guarded(<TagsPage />)} />
            <Route path="search" element={guarded(<SearchPage />)} />
            <Route path="entities" element={guarded(<EntitiesPage />)} />
            <Route path="entities/:id" element={guarded(<EntityDetailPage />)} />
            <Route path="guide" element={guarded(<GuidePage />)} />
            <Route path="settings" element={guarded(<SettingsPage />)} />
            <Route path="*" element={<p className="secondary">페이지를 찾을 수 없습니다.</p>} />
          </Route>
  ), { basename: import.meta.env.BASE_URL.replace(/\/$/, "") }));
  return <AuthProvider><RouterProvider router={router} /></AuthProvider>;
}
