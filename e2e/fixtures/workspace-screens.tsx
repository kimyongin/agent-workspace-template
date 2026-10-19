import { WorkspaceCapabilitiesContext } from "../../src/features/workspaces/workspace-context.tsx";
import { fixtureWorkspaceId } from "../support/workspace-scope.ts";
import { fixtureType } from "../support/workspace-data.ts";
import { FixtureWorkspace } from "./workspace-scope.tsx";
import { NavigationProtection } from "../../src/lib/navigation-protection.tsx";
import { WriteOutcomeNotice } from "../../src/components/WriteOutcomeNotice.tsx";
import { AuthProvider } from "../../src/features/auth/AuthProvider.tsx";
import { useContext, useState } from "react";
import { AuthContext } from "../../src/features/auth/auth-context.ts";
import { DetailNavigationProvider } from "../../src/lib/detail-exploration.tsx";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Outlet, RouterProvider } from "react-router";
import { EntitiesPage } from "../../src/features/entity/EntitiesPage.tsx";
import { EntityDetailPage } from "../../src/features/entity/EntityDetailPage.tsx";
import { TasksPage } from "../../src/features/activity/TasksPage.tsx";
import { TaskDetailPage } from "../../src/features/activity/TaskDetailPage.tsx";
import { RecordsPage } from "../../src/features/activity/RecordsPage.tsx";
import { RecordDetailPage } from "../../src/features/activity/RecordDetailPage.tsx";
import { TagsPage } from "../../src/features/tags/TagsPage.tsx";
import { SearchPage } from "../../src/features/search/SearchPage.tsx";
import { GuidePage } from "../../src/features/settings/GuidePage.tsx";
import "../../src/styles/app.css";
const target=new URLSearchParams(location.search).get("route")??"/entities";
if(location.pathname.endsWith("workspace-screens.html"))history.replaceState(null,"",target);
function FixtureLayout(){const [scope,setScope]=useState("account-a");return <main><WriteOutcomeNotice/><nav aria-label="Fixture routes"><button onClick={()=>setScope("account-b")}>계정 전환 fixture</button><Link to="/entities">엔터티 fixture</Link> · <Link to="/tasks">할 일 fixture</Link> · <Link to="/tasks?create=1&kind=recurring">작성 조건 변경 fixture</Link> · <Link to="/records">기록 fixture</Link> · <Link to="/tags/entity">엔터티 태그 fixture</Link> · <Link to="/tags/record">기록 태그 fixture</Link></nav><NavigationProtection><DetailNavigationProvider scope={scope}><Outlet/></DetailNavigationProvider></NavigationProtection></main>;}
const router=createBrowserRouter([{element:<FixtureLayout/>,children:[
  {path:"/entities",element:<EntitiesPage/>},{path:"/entities/:id",element:<EntityDetailPage/>},
  {path:"/tasks",element:<TasksPage/>},{path:"/tasks/:id",element:<TaskDetailPage/>},
  {path:"/records",element:<RecordsPage/>},{path:"/records/:id",element:<RecordDetailPage/>},
  {path:"/tags/:scope",element:<TagsPage/>},{path:"/tags/:scope/:id",element:<TagsPage/>},{path:"/search",element:<SearchPage/>},{path:"/guide",element:<GuidePage/>},
]}]);
// Match the real protected entry: no business request starts before Auth hydration.
function AuthenticatedWorkspace() {
  const { session, loading } = useContext(AuthContext);
  if (loading || !session) return null;
  return <FixtureWorkspace><WorkspaceCapabilitiesContext.Provider value={{ workspace: { id: fixtureWorkspaceId, name: "테스트 공간", deleted_at: null },
  grants: [{ target_kind: "settings", target_id: "*", access: "write" }, { target_kind: "tasks", target_id: "*", access: "write" }, { target_kind: "entity_type", target_id: fixtureType.id, access: "write" }],
  can_manage: true, membership_version: 1 }}><RouterProvider router={router}/></WorkspaceCapabilitiesContext.Provider></FixtureWorkspace>;
}
createRoot(document.getElementById("root")!).render(<AuthProvider><AuthenticatedWorkspace /></AuthProvider>);
