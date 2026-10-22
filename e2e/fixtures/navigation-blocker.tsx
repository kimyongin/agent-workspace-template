import { FixtureWorkspace } from "./workspace-scope.tsx";
// 실제 공통 UI + data-router 경로 차단을 격리해 초점 복귀만 검증한다. 제품 route에 포함하지 않는다.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider, useBlocker } from "react-router";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import { Button } from "../../src/components/ui/button.tsx";
import { Navigation } from "../../src/app/Navigation.tsx";
import { ConfirmDialog } from "../../src/components/Modal.tsx";
import "../../src/styles/app.css";

function DirtyPage() {
  const blocker = useBlocker(true);
  return <>
    <h1>저장하지 않은 태그 초안</h1>
    <Button>본문 조작</Button>
    <ConfirmDialog open={blocker.state === "blocked"} title="변경을 버릴까요?"
      message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기"
      onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
      onCancel={() => blocker.state === "blocked" && blocker.reset()} />
  </>;
}

const router = createMemoryRouter([{ element: <SidebarProvider><Outlet /><Navigation /></SidebarProvider>, children: [
  { path: "/tags", element: <DirtyPage /> },
  { path: "/logout", element: <h1>로그아웃 경로 진입</h1> },
] }], { initialEntries: ["/tags"] });
createRoot(document.getElementById("root")!).render(<StrictMode><FixtureWorkspace actorId="fixture-actor"><RouterProvider router={router} /></FixtureWorkspace></StrictMode>);
