import { fixtureWorkspaceId } from "../support/workspace-scope.ts";
import { createRoot } from "react-dom/client";
import "../../src/styles/app.css";
// 실제 App/data-router/RequireAuth를 사용하되 fixture 세션·API는 외부 서비스 없이 격리한다.
const session = { access_token: "fixture-access-token", refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: "90000000-0000-4000-8000-000000000000", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-04T00:00:00Z" } };
localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
history.replaceState(null, "", `/w/${fixtureWorkspaceId}/tasks`);
const { App } = await import("../../src/app/App.tsx");
createRoot(document.getElementById("root")!).render(<App />);
