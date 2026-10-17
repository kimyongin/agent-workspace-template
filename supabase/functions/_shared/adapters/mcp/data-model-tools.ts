import { z } from "zod";
import { dataModelAction, dataModelInput, dataModelPrepare } from "../../contracts/data-model.ts";
import {
  applyDataModel,
  type DataModelDeps,
  exportDataModel,
  getDataModelChange,
  listDataModelChanges,
  prepareDataModel,
  previewDataModel,
} from "../../core/data-model/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function dataModelTools(d: DataModelDeps): ToolDef[] {
  return [
    {
      name: "export_data_model",
      description:
        "보관된 것을 포함한 전체 자료 종류·관계·필요한 번호 설정을 일관된 JSON 스냅샷으로 내보냅니다. 실제 업무 자료·개별 연결은 포함하지 않습니다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: (_i, a) => exportDataModel(d, a),
    },
    {
      name: "preview_data_model",
      description:
        "전체 자료 모델 JSON 원문을 검증하고 update/copy 의도·전체 차이·ID/속성 대응·충돌·필요한 값 변환을 조회합니다. 정본·이력을 변경하지 않습니다.",
      input: dataModelInput,
      readOnly: true,
      handler: (i, a) => previewDataModel(d, a, i),
    },
    keyedTool({
      name: "prepare_data_model",
      description:
        "preview_fingerprint와 원문에 결속한 전체 모델 변경안을 한 이력으로 저장합니다. 아직 정본은 바꾸지 않습니다. 같은 request_key의 정확한 재시도만 재현합니다.",
      input: dataModelPrepare,
      readOnly: false,
      handler: (i, a) => prepareDataModel(d, a, i),
    }),
    {
      name: "list_data_model_changes",
      description: "소유자의 전체 모델 변경 이력을 페이지 조회합니다.",
      input: z.strictObject({
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().uuid().optional(),
      }),
      readOnly: true,
      handler: (i, a) => listDataModelChanges(d, a, i),
    },
    {
      name: "get_data_model_change",
      description: "전체 모델 변경안의 검토·상태·전체 적용 결과를 조회합니다.",
      input: z.strictObject({ id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => getDataModelChange(d, a, String(i.id)),
    },
    keyedTool({
      name: "apply_data_model",
      description:
        "검토한 전체 모델의 호환 변경/복사를 한 transaction에서 확정합니다. 기준이 바뀌거나 값 변환이 필요하면 어떤 종류도 부분 적용하지 않습니다. 응답 불명은 같은 request_key와 expected_version으로 확인합니다.",
      input: dataModelAction.extend({ id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { id, ...input } = i;
        return applyDataModel(d, a, String(id), input);
      },
    }),
  ];
}
