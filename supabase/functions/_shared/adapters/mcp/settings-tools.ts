import { z } from "zod";
import { businessSettingsUpdate } from "../../contracts/business-settings.ts";
import { prepareRecordMemo } from "../../contracts/record-preparation.ts";
import {
  type BusinessSettingsDeps,
  getBusinessSettings,
  prepareBusinessRecord,
  updateBusinessSettings,
} from "../../core/settings/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
// MCP requires a top-level object; the use case validates the selected section's discriminated contract.
const updateSettingsInput = z.strictObject({
  id: z.union([businessSettingsUpdate.options[0].shape.id, businessSettingsUpdate.options[1].shape.id]),
  expected_version: businessSettingsUpdate.options[0].shape.expected_version,
  value: z.union([businessSettingsUpdate.options[0].shape.value, businessSettingsUpdate.options[1].shape.value]),
});
export function settingsTools(deps: BusinessSettingsDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "get_business_settings",
      description: "사용자 업무 설정과 설정 ID별 versions 조회. 화면·프로필 설정과 별도 저장된다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: (_i, a) => getBusinessSettings(deps, a),
    },
    {
      name: "update_business_settings",
      description:
        "설정 id·해당 versions[id]의 expected_version·value로 한 섹션만 저장. 다른 설정 ID의 버전은 바뀌지 않는다. 기록 템플릿은 $변수$, 메모 최대 22000자·설정 131072바이트. 기존 record 태그만 사용. 구문·변수 오류는 위치와 이유 반환.",
      input: updateSettingsInput,
      readOnly: false,
      handler: (i, a) => updateBusinessSettings(deps, a, i),
    },
    {
      name: "prepare_record_memo",
      description:
        "저장 전 사용자 템플릿의 기록 메모·태그 준비. 수정/삭제/복원/중단/재개는 대상 id·현재 expected_version 필요. input은 실제 저장할 업무 필드이며 서버의 전체 이전 값과 병합한다. 반환한 prepared_input(발급처·설정 버전 포함; 내부 ID 발급 없음)과 change_note/change_tag_ids를 실제 쓰기에 명시하고 응답 불명 재시도에는 같은 request_key/대상/version/업무 입력/메모/태그를 그대로 사용한다. 명시 빈 태그 배열은 비움이다. 템플릿 변경 후에도 이미 준비한 값을 재계산하지 않는다.",
      input: prepareRecordMemo,
      readOnly: true,
      handler: (i, a) => prepareBusinessRecord(deps, a, i),
    },
  ];
  return tools.map((tool) => tool.readOnly || tool.name.startsWith("prepare_") ? tool : keyedTool(tool));
}
