import { DetailNavigationProvider } from "../../src/lib/detail-exploration.tsx";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Outlet, RouterProvider } from "react-router";
import { EntitiesPage } from "../../src/features/entity/EntitiesPage.tsx";
import { EntityDetailPage } from "../../src/features/entity/EntityDetailPage.tsx";
import { TasksPage } from "../../src/features/activity/TasksPage.tsx";
import { TaskDetailPage } from "../../src/features/activity/TaskDetailPage.tsx";
import { RecordsPage } from "../../src/features/activity/RecordsPage.tsx";
import { RecordDetailPage } from "../../src/features/activity/RecordDetailPage.tsx";
import { PrinciplesPage } from "../../src/features/principles/PrinciplesPage.tsx";
import { PrincipleDetailPage } from "../../src/features/principles/PrincipleDetailPage.tsx";
import { TagsPage } from "../../src/features/tags/TagsPage.tsx";
import { SearchPage } from "../../src/features/search/SearchPage.tsx";
import { GuidePage } from "../../src/features/settings/GuidePage.tsx";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";
const target=new URLSearchParams(location.search).get("route")??"/entities";
if(location.pathname.endsWith("workspace-screens.html"))history.replaceState(null,"",target);
const router=createBrowserRouter([{element:<main className="app-main"><nav aria-label="Fixture routes"><Link to="/entities">엔터티 fixture</Link> · <Link to="/tasks">할 일 fixture</Link> · <Link to="/tasks?create=1&kind=recurring">작성 조건 변경 fixture</Link> · <Link to="/records">기록 fixture</Link> · <Link to="/principles">원칙 fixture</Link> · <Link to="/tags/entity">엔터티 태그 fixture</Link> · <Link to="/tags/activity">활동 태그 fixture</Link></nav><DetailNavigationProvider><Outlet/></DetailNavigationProvider></main>,children:[
  {path:"/entities",element:<EntitiesPage/>},{path:"/entities/:id",element:<EntityDetailPage/>},
  {path:"/tasks",element:<TasksPage/>},{path:"/tasks/:id",element:<TaskDetailPage/>},
  {path:"/records",element:<RecordsPage/>},{path:"/records/:id",element:<RecordDetailPage/>},
  {path:"/principles",element:<PrinciplesPage/>},{path:"/principles/:id",element:<PrincipleDetailPage/>},
  {path:"/tags/:scope",element:<TagsPage/>},{path:"/tags/:scope/:id",element:<TagsPage/>},{path:"/search",element:<SearchPage/>},{path:"/guide",element:<GuidePage/>},
]}]);
createRoot(document.getElementById("root")!).render(<RouterProvider router={router}/>);
