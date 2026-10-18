import { WorkspaceCapabilitiesContext } from "../../src/features/workspaces/workspace-context.tsx";
import { fixtureType } from "../support/workspace-data.ts";
import { FixtureWorkspace, fixtureWorkspaceId } from "./workspace-scope.tsx";
import type { Session } from "@supabase/supabase-js";
import { AuthContext } from "../../src/features/auth/auth-context.ts";
import { NavigationProtection } from "../../src/lib/navigation-protection.tsx";
import { createRoot } from "react-dom/client";
import { TagDictionaryStatus, TagNames, TagReadProvider, useTagDictionary } from "../../src/features/tags/TagPicker.tsx";
import { useState } from "react";
import { createBrowserRouter, Link, Outlet, RouterProvider, useNavigate } from "react-router";
import { FormModal } from "../../src/components/ContentForm.tsx";
import { TagsPage } from "../../src/features/tags/TagsPage.tsx";
import { TaskDetailPage } from "../../src/features/activity/TaskDetailPage.tsx";
import { RecordDetailPage } from "../../src/features/activity/RecordDetailPage.tsx";
import { EntityDetailPage } from "../../src/features/entity/EntityDetailPage.tsx";
import "../../src/styles/app.css";
const router = createBrowserRouter([{
  element: (
    <NavigationProtection><main>
      <Link to="/e2e/fixtures/entity-tags.html?fixture=other">다른 화면</Link>
      <Link to="/entities/app%3A00000000-0000-4000-8000-000000000900%3A10000000-0000-4000-8000-000000000000">
        자료 fixture
      </Link>
      <Link to="/tasks/20000000-0000-4000-8000-000000000000">할 일 fixture</Link>
      <Link to="/records/30000000-0000-4000-8000-000000000000">기록 fixture</Link>
      <Link to="/modal-guard">모달 회귀</Link>
      <Outlet />
    </main></NavigationProtection>
  ),
  children: [
  { path: "/e2e/fixtures/entity-tags.html", element: new URLSearchParams(location.search).has("dictionary") ? <TagDictionaryFixture /> : <TagsPage /> },
  { path: "/entities/:id", element: <EntityDetailPage /> },
  { path: "/tasks/:id", element: <TaskDetailPage /> },
  { path: "/records/:id", element: <RecordDetailPage /> },
  { path: "/records", element: <h1>기록 목록 fixture</h1> },
  { path: "/modal-guard", element: <ModalDiscardFixture /> },
],
}]);
function TagDictionaryFixture() {
  const dictionary = useTagDictionary(true, true, "entity");
  return (
    <>
      <button onClick={() => window.dispatchEvent(new Event("focus"))}>
        화면 복귀
      </button>
      <TagDictionaryStatus dictionary={dictionary} />
      <TagReadProvider dictionary={dictionary}>
        <section aria-label="자료 이름 확인">
          {Array.from(
            { length: 20 },
            (_, i) => <TagNames key={i} compact scope="entity" ids={["00000000-0000-4000-8000-000000000000"]} />,
          )}
        </section>
        <section aria-label="다른 범위 확인">
          <TagNames compact scope="record" ids={["00000000-0000-4000-8000-000000000000"]} />
        </section>
      </TagReadProvider>
    </>
  );
}
function ModalDiscardFixture() {
  const [open, setOpen] = useState(true), [draft, setDraft] = useState("");
  const navigate = useNavigate();
  return (
    <FormModal open={open} title="경로 폐기 회귀" submitLabel="저장" dirty={!!draft} validate={() => null} onSubmit={async () => {}}
    onClose={() => { setOpen(false); navigate("/modal-guard?ordinary-close=1"); }} onRouteDiscard={() => { setOpen(false); setDraft(""); }}>
      {() => (
        <>
          <label>
            회귀 초안<input value={draft} onChange={e => setDraft(e.target.value)} />
          </label>
          <Link to="/modal-guard?intended=1">같은 모달 화면 이동</Link>
        </>
      )}
    </FormModal>
  );
}
createRoot(document.getElementById("root")!).render(<AuthContext.Provider value={{session: {user: {id:"tag-fixture-owner"}} as Session, loading:false, savePreferences:async()=>{throw new Error("fixture");}}}><FixtureWorkspace><WorkspaceCapabilitiesContext.Provider value={{
  workspace: { id: fixtureWorkspaceId, name: "태그 기능 검사 공간", deleted_at: null },
  membership_version: 1,
  can_manage: true,
  grants: [
    { target_kind: "settings", target_id: "*", access: "write" },
    { target_kind: "entity_type", target_id: fixtureType.id, access: "write" },
    { target_kind: "tasks", target_id: "*", access: "write" },
  ],
}}><RouterProvider router={router} /></WorkspaceCapabilitiesContext.Provider></FixtureWorkspace></AuthContext.Provider>);
