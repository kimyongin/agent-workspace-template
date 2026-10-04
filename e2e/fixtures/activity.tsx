// Isolated real feature UI: no AuthProvider, database, or server mutations.
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { RecordsPage } from "../../src/features/activity/RecordsPage.tsx";
import { RecordDetailPage } from "../../src/features/activity/RecordDetailPage.tsx";
import { TasksPage } from "../../src/features/activity/TasksPage.tsx";
import { TaskDetailPage } from "../../src/features/activity/TaskDetailPage.tsx";
import { PrinciplesPage } from "../../src/features/principles/PrinciplesPage.tsx";
import { PrincipleDetailPage } from "../../src/features/principles/PrincipleDetailPage.tsx";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";

history.replaceState({}, "", new URLSearchParams(location.search).get("route") ?? "/records");
const router = createBrowserRouter([
  {path:"/records",element:<RecordsPage />},
  {path:"/records/:id",element:<RecordDetailPage />},
  {path:"/tasks",element:<TasksPage />},
  {path:"/tasks/:id",element:<TaskDetailPage />},
  {path:"/principles",element:<PrinciplesPage />},
  {path:"/principles/:id",element:<PrincipleDetailPage />},
]);
createRoot(document.getElementById("root")!).render(<main className="app-main"><RouterProvider router={router} /></main>);
