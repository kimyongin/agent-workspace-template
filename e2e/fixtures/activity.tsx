// Isolated real feature UI: no AuthProvider, database, or server mutations.
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Link, useLocation } from "react-router";
import { RecordsPage } from "../../src/features/activity/RecordsPage.tsx";
import { RecordDetailPage } from "../../src/features/activity/RecordDetailPage.tsx";
import { TasksPage } from "../../src/features/activity/TasksPage.tsx";
import { TaskDetailPage } from "../../src/features/activity/TaskDetailPage.tsx";
import { PrinciplesPage } from "../../src/features/principles/PrinciplesPage.tsx";
import { PrincipleDetailPage } from "../../src/features/principles/PrincipleDetailPage.tsx";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";

history.replaceState({}, "", new URLSearchParams(location.search).get("route") ?? "/records");
function RouteProbe({children}:{children:React.ReactNode}) {
  const location=useLocation();
  return <><output hidden aria-label="fixture 현재 경로">{location.pathname+location.search}</output><Link to="?fixture=next" aria-label="fixture 같은 화면 조건 이동">조건 이동</Link>{children}</>;
}
const withRouteProbe = (feature: React.ReactNode) => <RouteProbe>{feature}</RouteProbe>;
const router = createBrowserRouter([
  {path:"/records",element:withRouteProbe(<RecordsPage />)},
  {path:"/records/:id",element:withRouteProbe(<RecordDetailPage />)},
  {path:"/tasks",element:withRouteProbe(<TasksPage />)},
  {path:"/tasks/:id",element:withRouteProbe(<TaskDetailPage />)},
  {path:"/principles",element:withRouteProbe(<PrinciplesPage />)},
  {path:"/principles/:id",element:withRouteProbe(<PrincipleDetailPage />)},
]);
createRoot(document.getElementById("root")!).render(<main className="app-main"><RouterProvider router={router} /></main>);
