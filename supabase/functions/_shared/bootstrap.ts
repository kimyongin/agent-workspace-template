import { SqlEntityIssuerUnitOfWork } from "./adapters/supabase/entity-issuer-store.ts";
import type { EntityIssuerDeps } from "./core/entity-issuers/application.ts";
import { SqlStatusReader } from "./adapters/supabase/status-reader.ts";
import type { StatusDeps } from "./core/status/application.ts";
// 실행 환경에서 실제 구현을 조립한다. 요청마다 Actor는 진입점이 검증해 유스케이스에 넘긴다.
import postgres from "postgres";
import { SqlUnitOfWork } from "./adapters/supabase/activity-store.ts";
import type { ActivityDeps } from "./core/activity/application.ts";
import { SqlTagUnitOfWork } from "./adapters/supabase/tag-store.ts";
import type { TagDeps } from "./core/tags/application.ts";
import type { SearchDeps } from "./core/search/application.ts";
import { SqlSearchUnitOfWork } from "./adapters/supabase/search-store.ts";
import { PineconeEmbedder } from "./adapters/pinecone/embedder.ts";
import { SqlEntityUnitOfWork } from "./adapters/supabase/entity-store.ts";
import type { EntityDeps } from "./core/entity/application.ts";
import { SqlBusinessSettingsUnitOfWork } from "./adapters/supabase/business-settings-store.ts";
import type { BusinessSettingsDeps } from "./core/settings/application.ts";
let status: StatusDeps | undefined;
export function statusDeps(): StatusDeps {
  return status ??= { reader: new SqlStatusReader(database()), clock: { now: () => new Date() } };
}

let settings: BusinessSettingsDeps | undefined;
export function businessSettingsDeps(): BusinessSettingsDeps {
  return settings ??= { uow: new SqlBusinessSettingsUnitOfWork(database()), clock: { now: () => new Date() } };
}

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`환경변수 ${name}이 필요합니다`);
  return v;
}

let deps: ActivityDeps | undefined;
let connection: postgres.Sql | undefined;
let tags: TagDeps | undefined;
let search: SearchDeps | undefined;
let entities: EntityDeps | undefined;
export function entityDeps(): EntityDeps {
  return entities ??= { uow: new SqlEntityUnitOfWork(database()) };
}
export function searchDeps(): SearchDeps {
  const key = Deno.env.get("PINECONE_API_KEY");
  return search ??= {
    uow: new SqlSearchUnitOfWork(database()),
    ...(key ? { embedder: new PineconeEmbedder(key) } : {}),
  };
}
export function tagDeps(): TagDeps {
  return tags ??= { uow: new SqlTagUnitOfWork(database()) };
}
function database() {
  return connection ??= postgres(required("APP_DB_URL"), {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    onnotice: () => {},
  });
}

/** 트랜잭션 풀러(Supavisor) 연결. prepared statement를 지원하지 않으므로 prepare: false. */
export function activityDeps(): ActivityDeps {
  if (!deps) {
    const sql = database();
    deps = {
      uow: new SqlUnitOfWork(sql),
      clock: { now: () => new Date() },
    };
  }
  return deps;
}

export const env = {
  /** 토큰 발급자(Supabase Auth의 공개 주소 + /auth/v1). */
  authIssuer: () => required("AUTH_ISSUER"),
  /** Auth와 같은 프로젝트의 표준 MCP 주소. 토큰 hook과 같은 규칙으로 계산한다. */
  mcpUrl: () => {
    const issuer = required("AUTH_ISSUER");
    if (!/^https?:\/\/[^/?#@\s]+\/auth\/v1$/.test(issuer)) throw new Error("invalid Auth issuer");
    return issuer.slice(0, -"/auth/v1".length) + "/functions/v1/mcp";
  },
  webOrigins: () => (Deno.env.get("WEB_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};

import { SqlEntityTypeUnitOfWork } from "./adapters/supabase/entity-type-store.ts";
import type { EntityTypeDeps } from "./core/entity-types/application.ts";
let entityTypes: EntityTypeDeps | undefined;
export function entityTypeDeps(): EntityTypeDeps {
  return entityTypes ??= { uow: new SqlEntityTypeUnitOfWork(database()) };
}

let issuers: EntityIssuerDeps | undefined;
export function entityIssuerDeps(): EntityIssuerDeps {
  return issuers ??= { uow: new SqlEntityIssuerUnitOfWork(database()) };
}

import { SqlEntityRelationDefinitionUnitOfWork } from "./adapters/supabase/entity-relation-definition-store.ts";
import type { EntityRelationDefinitionDeps } from "./core/entity-relations/application.ts";
let relationDefinitions: EntityRelationDefinitionDeps | undefined;
export function entityRelationDefinitionDeps(): EntityRelationDefinitionDeps {
  return relationDefinitions ??= { uow: new SqlEntityRelationDefinitionUnitOfWork(database()) };
}

import { SqlEntityRelationLinkUnitOfWork } from "./adapters/supabase/entity-relation-link-store.ts";
import type { EntityRelationLinkDeps } from "./core/entity-relations/links.ts";
let relationLinks: EntityRelationLinkDeps | undefined;
export function entityRelationLinkDeps(): EntityRelationLinkDeps {
  return relationLinks ??= { uow: new SqlEntityRelationLinkUnitOfWork(database()) };
}

import { SqlDataModelGroupStore } from "./adapters/supabase/data-model-group-store.ts";
import { SqlDataModelUnitOfWork } from "./adapters/supabase/data-model-store.ts";
import type { DataModelDeps } from "./core/data-model/application.ts";
let model: DataModelDeps | undefined;
export function dataModelDeps(): DataModelDeps {
  return model ??= { uow: new SqlDataModelUnitOfWork(database(), SqlDataModelGroupStore) };
}

import { SqlCreateAndLinkUnitOfWork } from "./adapters/supabase/create-and-link-store.ts";
import type { CreateAndLinkDeps } from "./core/entity-relations/create-and-link.ts";
let createAndLink: CreateAndLinkDeps | undefined;
export function createAndLinkDeps(): CreateAndLinkDeps {
  return createAndLink ??= { uow: new SqlCreateAndLinkUnitOfWork(database()) };
}

import { SqlWorkspaceUnitOfWork } from "./adapters/supabase/workspace-store.ts";
import type { WorkspaceDeps } from "./core/workspaces/application.ts";
let workspaces: WorkspaceDeps | undefined;
export function workspaceDeps(): WorkspaceDeps {
  return workspaces ??= { uow: new SqlWorkspaceUnitOfWork(database()) };
}
