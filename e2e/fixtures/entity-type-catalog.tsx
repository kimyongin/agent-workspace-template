import { FixtureWorkspace, fixtureWorkspaceId } from "./workspace-scope.tsx";
import type { Session } from "@supabase/supabase-js";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthContext } from "../../src/features/auth/auth-context.ts";
import { useEntityTypes } from "../../src/features/entity/useEntityTypes.ts";
import { invalidateEntityTypeCatalog } from "../../src/features/entity/entity-type-catalog.ts";

function Reader() {
  const catalog = useEntityTypes();
  return <>
    <p role="status">{catalog.types?.map((type) => type.label).join(" · ") ?? "읽는 중"}</p>
    {catalog.error && <p role="alert">조회 실패</p>}
    <button onClick={catalog.retry}>조회 다시 시도</button>
  </>;
}
function Fixture() {
  const [owner, setOwner] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  // Only this fixture supplies display context; production authentication remains unchanged.
  const session = owner ? { user: { id: owner } } as Session : null;
  return <AuthContext.Provider value={{ session, loading: false, savePreferences: async () => { throw new Error("읽기 전용 fixture"); } }}>
    <button onClick={() => setOwner("owner-a")}>계정 A</button>
    <button onClick={() => setOwner("owner-b")}>계정 B</button>
    <button onClick={() => setOwner(null)}>로그아웃</button>
    <button onClick={() => invalidateEntityTypeCatalog({ actorId: "owner-a", workspaceId: fixtureWorkspaceId })}>계정 A 갱신</button>
    <button onClick={() => invalidateEntityTypeCatalog({ actorId: "owner-b", workspaceId: fixtureWorkspaceId })}>계정 B 갱신</button>
    <button onClick={() => setVisible((value) => !value)}>읽기 화면 전환</button>
    {visible && <FixtureWorkspace><Reader /></FixtureWorkspace>}
  </AuthContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
