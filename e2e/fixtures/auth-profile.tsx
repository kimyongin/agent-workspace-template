// 실제 provider·설정·SDK의 경쟁을 관찰한다. 인증 동작을 대체하지 않는다.
import { useDisplayTime } from "../../src/lib/useDisplayTime.ts";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthProvider, useAuth } from "../../src/features/auth/AuthProvider.tsx";
import { SettingsPage } from "../../src/features/settings/SettingsPage.tsx";
import { Navigation } from "../../src/app/Navigation.tsx";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";

function Probe() {
  const { session, loading, savePreferences } = useAuth();
  const display = useDisplayTime();
  const [result, setResult] = useState("idle");
  return <div className="has-navigation"><main className="app-main">
    <output data-testid="provider-account">{loading ? "loading" : session?.user.id ?? "signed-out"}</output>
    <output data-testid="provider-icon">{session?.user.user_metadata.workspace_avatar_id ?? "none"}</output>
    <output data-testid="display-timezone">{display.timezone}</output>
    <output data-testid="display-date">{display.formatDateTime("2026-10-07T23:15:00Z")}</output>
    <output data-testid="save-result">{result}</output>
    <button onClick={async () => {
      setResult("pending");
      try { await savePreferences({ icon: "sun" }); setResult("saved"); }
      catch { setResult("rejected"); }
    }}>지연 저장 검사</button>
    <SettingsPage /></main><Navigation brand="Workspace" />
  </div>;
}
const router = createMemoryRouter([{ path: "*", element: <Probe /> }], { initialEntries: ["/settings"] });
createRoot(document.getElementById("root")!).render(<AuthProvider><RouterProvider router={router} /></AuthProvider>);
