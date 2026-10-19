import { FixtureWorkspace } from "./workspace-scope.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, useLocation } from "react-router";
import {
  migrationLabels,
  SchemaMigrationJob,
  useMigrationHistory,
} from "../../src/features/settings/SchemaMigrationJobs.tsx";
import "../../src/styles/app.css";
const stateChange = () => {};
function History({ typeId }: { typeId: string }) {
  const history = useMigrationHistory(typeId);
  return (
    <section aria-label="변환 이력">
      {history.error && <p role="alert">{history.error}</p>}
      <button onClick={history.refresh}>작업 목록 다시 조회</button>
      {history.items.map((job) => (
        <div key={job.id}>
          <Link to={`?job=${job.id}`}>
            {job.type.label} · {migrationLabels[job.status]} · {job.processed}/{job.total}
          </Link>
        </div>
      ))}
      {history.before && (
        <button disabled={history.moreBusy} onClick={() => void history.more()}>이전 작업 더 보기</button>
      )}
    </section>
  );
}
function Screen() {
  const [selectedTypeId, setTypeId] = useState("00000000-0000-4000-8000-000000000001");
  const location = useLocation(), params = new URLSearchParams(location.search);
  const typeId = location.pathname.match(/^\/settings\/entity-types\/([^/]+)$/)?.[1] ?? selectedTypeId;
  const initialJob = params.get("job");
  const jobId = params.get("job_id") ?? (initialJob
    ? /^\d+$/.test(initialJob) ? `00000000-0000-4000-8000-${initialJob.padStart(12, "0")}` : initialJob
    : null);
  return (
    <main>
      <button onClick={() => setTypeId("00000000-0000-4000-8000-000000000002")}>상품 작업으로 이동</button>
      {jobId
        ? <SchemaMigrationJob typeId={typeId} jobId={jobId} onState={stateChange} />
        : <History typeId={typeId} />}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<FixtureWorkspace actorId="fixture-actor"><MemoryRouter initialEntries={[window.location.pathname + window.location.search]}><Screen /></MemoryRouter></FixtureWorkspace>);
