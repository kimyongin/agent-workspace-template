import { entitySchemaImportPrepare, type EntitySchemaImportResult } from "../../contracts/entity-schema-import.ts";
import type { EntityTypeDeps } from "./application.ts";
import type { Actor } from "../shared/actor.ts";
import { requestIdentity } from "../shared/request.ts";
import { invalidInput } from "../shared/errors.ts";
/** Retired mutation: only an exact retained successful receipt may be read. */
export async function replayEntitySchemaImport(
  d: EntityTypeDeps,
  actor: Actor,
  raw: unknown,
): Promise<EntitySchemaImportResult> {
  const parsed = entitySchemaImportPrepare.safeParse(raw);
  if (!parsed.success) throw invalidInput("이전 가져오기 완료 요청의 정확한 원본 입력이 필요합니다");
  const input = parsed.data,
    request = await requestIdentity(
      actor,
      "entity-schema-import.prepare",
      input.mode === "update" ? input.type_id : null,
      input,
    );
  return d.uow.run(actor, async (store) => {
    const replay = await store.replayRetainedRequest<EntitySchemaImportResult>?.(request);
    if (replay?.found) return replay.result!;
    throw invalidInput("개별 정의 가져오기는 종료되었습니다. 전체 자료 모델 가져오기를 사용하세요");
  });
}
