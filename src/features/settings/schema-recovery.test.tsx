import { expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { ConversionEditor } from "./ConversionEditor.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import { ApiError } from "../../lib/api-error.ts";
import { WriteAttempt } from "../../lib/write-attempt.ts";
vi.mock("../../lib/api.ts", () => ({ api: vi.fn() }));
import {
  RecoveryAvailability,
  RecoveryChangeCreate,
  RecoveryConflictList,
  recoveryErrorMessage,
  submitRecoveryChange,
} from "./SchemaRecovery.tsx";

const job = {
  id: "job-1",
  version: 7,
  status: "succeeded",
  type_id: "type-1",
  source_expires_at: "2026-11-10T12:00:00Z",
  recovery: { status: "available", reason: null, current_type_version: 12, current_schema_version: 4 },
} as EntitySchemaMigration;

it("완료 작업은 서버가 확인한 복구 가능 여부와 보존 기한을 함께 보여 준다", () => {
  const html = renderToStaticMarkup(<RecoveryAvailability job={job} />);
  expect(html).toContain("복구안 생성 가능");
  expect(html).toMatch(/datetime="2026-11-10T12:00:00Z"/i);
  const expired = renderToStaticMarkup(
    <RecoveryAvailability job={{ ...job, recovery: { ...job.recovery!, status: "expired" } }} />,
  );
  expect(expired).toContain("원본 보존 기간 만료");
  expect(expired).not.toContain("복구안 생성 가능");
});

it("복구안 요청은 원본 작업과 현재 종류·속성 버전만 보내고 응답 불명은 같은 키·입력으로 재확인한다", async () => {
  const client = vi.fn().mockRejectedValueOnce(new ApiError(0, "network", "응답 유실")).mockResolvedValueOnce({
    id: "recovery-draft",
  });
  const attempt = new WriteAttempt();
  await expect(attempt.run(async () => {
    await submitRecoveryChange(job, attempt.requestKey(), client);
  })).rejects.toThrow("응답 유실");
  await attempt.run(async () => {
    await submitRecoveryChange({ ...job, version: 99 }, attempt.requestKey(), client);
  });
  expect(client.mock.calls[0]).toEqual([
    "POST",
    "/entity-schema-migrations/job-1/recovery-changes",
    { expected_job_version: 7, expected_type_version: 12, expected_schema_version: 4 },
    undefined,
    expect.stringMatching(/^[0-9a-f-]{36}$/),
  ]);
  expect(client.mock.calls[1]).toEqual(client.mock.calls[0]);
});

it("만료·이후 변경 오류는 입력 보존과 다음 검토 방법을 안내한다", () => {
  expect(recoveryErrorMessage(new ApiError(410, "migration_source_expired", "expired"))).toContain(
    "입력한 내용은 유지",
  );
  expect(recoveryErrorMessage(new ApiError(409, "schema_plan_stale", "연결 변경"))).toContain("연결 변경");
  expect(recoveryErrorMessage(new ApiError(409, "conflict", "자료 변경"))).toContain("새 변경안을 분석");
});

it("복구 충돌 사유와 기한은 과거 작업을 읽을 때도 최신 종류 상태를 설명한다", () => {
  const html = renderToStaticMarkup(
    <RecoveryAvailability
      job={{ ...job, recovery: { ...job.recovery!, status: "conflict", reason: "보관된 자료 종류를 먼저 복원하세요" } }}
    />,
  );
  expect(html).toContain("이후 변경 확인 필요");
  expect(html).toContain("보관된 자료 종류를 먼저 복원하세요");
  expect(renderToStaticMarkup(<RecoveryAvailability job={{ ...job, status: "failed" }} />)).toBe("");
});

it("원본 만료나 자료 없음 상태에는 복구 생성 버튼을 비활성화하고 기존 분석 경로를 유지한다", () => {
  for (const status of ["expired", "unavailable", "conflict"] as const) {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RecoveryChangeCreate job={{ ...job, recovery: { ...job.recovery!, status } }} />
      </MemoryRouter>,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>원본 복구안 만들기<\/button>/);
    expect(html).toContain("/settings/entity-types/type-1");
  }
  const available = renderToStaticMarkup(
    <MemoryRouter>
      <RecoveryChangeCreate job={job} />
    </MemoryRouter>,
  );
  expect(available).toContain("원본 복구안 만들기");
  expect(available).not.toContain('disabled=""');
  expect(available).toContain("영향 분석");
});

it("복구 미리보기는 서버 원본 계획을 유지하고 편집할 수 없는 보완 입력을 제공하지 않는다", () => {
  const plan = {
    id: "change",
    type_id: "type-1",
    recovery: { source_job_id: "job-1", source_expires_at: "2026-11-10T12:00:00Z" },
    analysis: null,
    migration: { rules: [], overrides: [] },
  } as unknown as EntitySchemaChange;
  const html = renderToStaticMarkup(
    <ConversionEditor plan={plan} migration={plan.migration} onChange={() => {}} disabled />,
  );
  expect(html).toContain("복구 값 영향 미리보기");
  expect(html).not.toContain("변환 방식");
  expect(html).not.toContain("보완값 지정");
});

it("복구 충돌 목록은 자료 식별자를 안전한 상세 링크로 제공하고 연결·선택 사유를 설명한다", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <RecoveryConflictList
        conflicts={[
          { path: "entities.crm:00000000-0000-4000-8000-000000000001:VIP/a.b", message: "완료 후 값이 변경되었습니다" },
          { path: "references", message: "할 일의 선택이 변경되었습니다" },
          { path: "entities.removed", message: "자료 구성이 변경되었습니다" },
        ]}
      />
    </MemoryRouter>,
  );
  expect(html).toContain('href="/entities/crm%3A00000000-0000-4000-8000-000000000001%3AVIP%2Fa.b"');
  expect(html).toContain(">crm · VIP/a.b</a>");
  expect(html).toContain("연결·선택: 할 일의 선택이 변경되었습니다");
  expect(html).not.toContain('href="/entities/removed"');
});

it("속성 변경·종류 보관 오류도 입력을 보존하고 필드별 충돌 사유를 함께 안내한다", () => {
  const fields = [{
    path: "entities.app:00000000-0000-4000-8000-000000000001:one",
    message: "완료 후 자료가 수정되었습니다",
  }];
  const changed = recoveryErrorMessage(new ApiError(409, "schema_changed", "현재 속성 변경", fields));
  expect(changed).toContain("입력은 유지");
  expect(changed).toContain("app · one: 완료 후 자료가 수정되었습니다");
  expect(changed).toContain("새 변경안을 분석");
  expect(recoveryErrorMessage(new ApiError(409, "entity_type_archived", "보관 상태"))).toContain(
    "자료 종류를 먼저 복원",
  );
});
