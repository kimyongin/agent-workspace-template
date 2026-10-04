import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, Outlet, RouterProvider } from "react-router";
import { TagsPage } from "../../src/features/tags/TagsPage.tsx";
import { EntityDetailPage } from "../../src/features/entity/EntityDetailPage.tsx";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";
const router = createBrowserRouter([{ element: <main className="app-main"><Link to="/e2e/fixtures/entity-tags.html?view=other">다른 화면</Link><Link to="/entities/10000000-0000-4000-8000-000000000000">엔터티</Link><Outlet /></main>, children: [
  { path: "/e2e/fixtures/entity-tags.html", element: <TagsPage /> },
  { path: "/entities/:id", element: <EntityDetailPage /> },
] }]);
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
