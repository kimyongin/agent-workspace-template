// 앱 조립: 경로·메뉴·브랜드. 새 도메인은 메뉴와 경로를 여기서 바꾼다.
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router";
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
import { supabase } from "../lib/supabase.ts";

export const APP_NAME = "Workspace";

function Layout() {
  const { session } = useAuth();
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">{APP_NAME}</span>
        {session && (
          <>
            <nav className="app-nav" aria-label="주 메뉴">
              <NavLink to="/tasks">할 일</NavLink>
              <NavLink to="/records">기록</NavLink>
              <NavLink to="/principles">원칙</NavLink>
              <NavLink to="/tags">태그</NavLink>
              <NavLink to="/search">검색</NavLink>
            </nav>
            <button type="button" className="btn btn-text" onClick={() => supabase.auth.signOut()}>로그아웃</button>
          </>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

const guarded = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;

export function App() {
  return (
    <AuthProvider>
      {/* GitHub Pages 경로(VITE_BASE) 아래에서 동작한다. 상세 URL 직접 진입은 404.html 대체로 처리한다. */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/tasks" replace />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="oauth/consent" element={guarded(<ConsentPage />)} />
            <Route path="tasks" element={guarded(<TasksPage />)} />
            <Route path="tasks/:id" element={guarded(<TaskDetailPage />)} />
            <Route path="records" element={guarded(<RecordsPage />)} />
            <Route path="records/:id" element={guarded(<RecordDetailPage />)} />
            <Route path="principles" element={guarded(<PrinciplesPage />)} />
            <Route path="principles/:id" element={guarded(<PrincipleDetailPage />)} />
            <Route path="tags" element={guarded(<TagsPage />)} />
            <Route path="search" element={guarded(<SearchPage />)} />
            <Route path="*" element={<p className="secondary">페이지를 찾을 수 없습니다.</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
