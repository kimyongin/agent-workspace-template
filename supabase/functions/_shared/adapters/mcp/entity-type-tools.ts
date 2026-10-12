import {
  cancelEntitySchemaMigration,
  getEntitySchemaMigration,
  listEntitySchemaMigrations,
  retryEntitySchemaMigration,
  startEntitySchemaMigration,
} from "../../core/entity-types/schema-migrations.ts";
import {
  schemaMigrationAction,
  schemaMigrationList,
  schemaMigrationStart,
} from "../../contracts/entity-schema-migration.ts";
import {
  schemaAnalysisRows,
  schemaChangeAction,
  schemaChangeApply,
  schemaChangeCreate,
  schemaChangeList,
  schemaChangeUpdate,
} from "../../contracts/entity-schema-change.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaAnalysisRows,
  getEntitySchemaChange,
  listEntitySchemaChanges,
  updateEntitySchemaChange,
} from "../../core/entity-types/schema-changes.ts";
import { z } from "zod";
import {
  entitySchemaHistory,
  entitySchemaRead,
  entityTypeCreate,
  entityTypeIcons,
  entityTypeList,
  entityTypeUpdate,
} from "../../contracts/entity-type.ts";
import {
  createEntityType,
  type EntityTypeDeps,
  getEntitySchema,
  getEntityType,
  listEntitySchemaVersions,
  listEntityTypes,
  updateEntityType,
} from "../../core/entity-types/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function entityTypeTools(deps: EntityTypeDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "start_entity_schema_migration",
      description:
        "최신 성공 분석·fingerprint·type/schema/change version을 확인하여 값 변환 접수. job_id로 상태 조회, request_key 필수. 준비 중 같은 종류 쓰기 차단.",
      input: schemaMigrationStart.extend({ type_id: z.string().uuid(), change_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, change_id, ...raw } = i;
        return startEntitySchemaMigration(deps, a, String(type_id), String(change_id), raw);
      },
    },
    {
      name: "get_entity_schema_migration",
      description:
        "값 변환 작업 상태·건수·확정 결과·재시도 여부·원본 만료 조회. timeout/lease 만료는 실패 확정이 아닙니다.",
      input: z.strictObject({ job_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => getEntitySchemaMigration(deps, a, String(i.job_id)),
    },
    {
      name: "list_entity_schema_migrations",
      description: "소유자의 값 변환 작업을 종류·limit/before로 조회.",
      input: schemaMigrationList,
      readOnly: true,
      handler: (i, a) => listEntitySchemaMigrations(deps, a, i),
    },
    {
      name: "cancel_entity_schema_migration",
      description:
        "expected_job_version을 확인하여 commit 전 작업 취소. 경쟁한 commit/성공의 확정 상태를 반환. request_key 필수.",
      input: schemaMigrationAction.extend({ job_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { job_id, ...raw } = i;
        return cancelEntitySchemaMigration(deps, a, String(job_id), raw);
      },
    },
    {
      name: "retry_entity_schema_migration",
      description:
        "retryable failed인 같은 작업을 최신 source/plan 대조 후 재개. cancelled/stale은 재분석. expected_job_version·새 의도 request_key 필수.",
      input: schemaMigrationAction.extend({ job_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { job_id, ...raw } = i;
        return retryEntitySchemaMigration(deps, a, String(job_id), raw);
      },
    },
    {
      name: "create_entity_schema_change",
      description:
        "자료 종류의 속성 변경 초안 저장. add_property client_ref를 prop_n으로 영구 예약. 제한된 편집만 지원, request_key 필수.",
      input: schemaChangeCreate.extend({ type_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, ...raw } = i;
        return createEntitySchemaChange(deps, a, String(type_id), raw);
      },
    },
    {
      name: "update_entity_schema_change",
      description: "변경 초안 버전을 확인하여 수정. 예약 번호는 회수하지 않으며 새 분석 필요.",
      input: schemaChangeUpdate.extend({ type_id: z.string().uuid(), change_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, change_id, ...raw } = i;
        return updateEntitySchemaChange(deps, a, String(type_id), String(change_id), raw);
      },
    },
    {
      name: "get_entity_schema_change",
      description: "변경 초안·정확한 차이·영향 분석 상태 조회. 게시하지 않습니다.",
      input: z.strictObject({ type_id: z.string().uuid(), change_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => getEntitySchemaChange(deps, a, String(i.type_id), String(i.change_id)),
    },
    {
      name: "list_entity_schema_changes",
      description: "자료 종류의 변경 초안을 제한된 페이지로 조회.",
      input: schemaChangeList.extend({ type_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => {
        const { type_id, ...raw } = i;
        return listEntitySchemaChanges(deps, a, String(type_id), raw);
      },
    },
    {
      name: "analyze_entity_schema_change",
      description:
        "변경 버전과 전체 자료 snapshot을 고정해 비동기 영향 분석 접수. analysis.id는 분석 참조. GET으로 상태 확인, request_key 필수.",
      input: schemaChangeAction.extend({ type_id: z.string().uuid(), change_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, change_id, ...raw } = i;
        return analyzeEntitySchemaChange(deps, a, String(type_id), String(change_id), raw);
      },
    },
    {
      name: "list_entity_schema_analysis_rows",
      description:
        "분석의 원본·변환값·실패를 자료 ID 순서의 제한된 페이지로 조회. 미완료 분석은 성공으로 보이지 않습니다.",
      input: schemaAnalysisRows.extend({ type_id: z.string().uuid(), change_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => {
        const { type_id, change_id, ...raw } = i;
        return getEntitySchemaAnalysisRows(deps, a, String(type_id), String(change_id), raw);
      },
    },
    {
      name: "apply_entity_schema_change",
      description:
        "최신 성공 분석에 결속한 compatible 변경만 새 불변 버전으로 게시. 기존 자료는 다시 저장하지 않습니다. migration_required는 별도 값 변환 실행 필요.",
      input: schemaChangeApply.extend({ type_id: z.string().uuid(), change_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, change_id, ...raw } = i;
        return applyEntitySchemaChange(deps, a, String(type_id), String(change_id), raw);
      },
    },
    {
      name: "list_entity_type_icons",
      description: "자료 종류의 지원 icon_id·라벨 목록. 알 수 없는 저장 아이콘은 box로 표시합니다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: () => Promise.resolve({ items: entityTypeIcons }),
    },
    {
      name: "list_entity_types",
      description: "현재 소유자의 자료 종류 목록. include_archived, limit/cursor로 보관 상태와 bounded 페이지 조회.",
      input: entityTypeList,
      readOnly: true,
      handler: (i, a) => listEntityTypes(deps, a, i),
    },
    {
      name: "get_entity_type",
      description: "자료 종류의 이름·아이콘·보관 상태·metadata version·현재 schema_version 조회.",
      input: z.strictObject({ type_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => getEntityType(deps, a, String(i.type_id)),
    },
    {
      name: "create_entity_type",
      description: "자료 종류와 초기 필수 대표 텍스트 prop_1 정의를 원자적으로 생성. 새 ID는 성공 응답으로 발급.",
      input: entityTypeCreate,
      readOnly: false,
      handler: (i, a) => createEntityType(deps, a, i),
    },
    {
      name: "update_entity_type",
      description:
        "자료 종류 이름·icon_id·archived 수정. expected_type_version 필요, expected_schema_version을 선택적으로 함께 확인. 속성/값을 변경하지 않습니다.",
      input: entityTypeUpdate.safeExtend({ type_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, ...input } = i;
        return updateEntityType(deps, a, String(type_id), input);
      },
    },
    {
      name: "get_entity_schema",
      description:
        "type_id별 현재 또는 schema_version의 불변 Draft 2020-12 정의·표시 설정 조회. 기본값은 생성에만 적용.",
      input: entitySchemaRead,
      readOnly: true,
      handler: (i, a) => getEntitySchema(deps, a, i),
    },
    {
      name: "list_entity_schema_versions",
      description:
        "type_id별 불변 버전 목록을 최신순으로 조회. limit/before 페이지. metadata version과 schema_version은 별개.",
      input: entitySchemaHistory,
      readOnly: true,
      handler: (i, a) => listEntitySchemaVersions(deps, a, i),
    },
  ];
  return tools.map((tool) => tool.readOnly ? tool : keyedTool(tool));
}
