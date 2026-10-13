import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { MigrationJobs, SchemaMigrationJob } from "../../src/features/settings/SchemaMigrationJobs.tsx";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";
const stateChange = () => {};
function Screen() {
  const [typeId, setTypeId] = useState("00000000-0000-4000-8000-000000000001");
  return (
    <MemoryRouter>
      <main>
        <button onClick={() => setTypeId("00000000-0000-4000-8000-000000000002")}>상품 작업으로 이동</button>
        {new URLSearchParams(window.location.search).has("job")
          ? <SchemaMigrationJob typeId={typeId} jobId="00000000-0000-4000-8000-000000000030" onState={stateChange} />
          : <MigrationJobs typeId={typeId} />}
      </main>
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(<Screen />);
