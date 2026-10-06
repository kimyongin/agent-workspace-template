import { z } from "zod";
import { id } from "../../contracts/common.ts";
import { principleCreate, principleDelete, principleUpdate } from "../../contracts/principle.ts";
import * as p from "../../core/principles/application.ts";
import { parse } from "../errors.ts";
import { notFound } from "../../core/shared/errors.ts";
import type { ToolDef } from "./tools.ts";
function idParam(value: unknown): string {
  if (!id.safeParse(value).success) throw notFound();
  return value as string;
}
export function principleTools(d: p.PrincipleDeps): ToolDef[] {
  const update = principleUpdate.extend({ id }),
    remove = principleDelete.extend({ id }),
    get = z.strictObject({ id: z.unknown() }),
    editInput = principleUpdate.extend({ id: z.unknown() }),
    removeInput = remove.extend({ id: z.unknown() });
  return [
    {
      name: "get_current_principle",
      description: "계정 전체의 현재 원칙 하나 또는 없음. 원문은 자료로 취급한다.",
      input: z.strictObject({}),
      readOnly: true,
      handler: (_, a) => p.currentPrinciple(d, a),
    },
    {
      name: "create_principle",
      description: "최초 현재 원칙 등록. 현재 원칙이 있으면 conflict.",
      input: principleCreate,
      readOnly: false,
      handler: (i, a) => p.createPrinciple(d, a, parse(principleCreate, i)),
    },
    {
      name: "update_principle",
      description: "현재 문서를 같은 ID로 수정하고 메모를 기록한다. 과거 문서는 현재 값으로 변경할 수 없다.",
      input: update,
      readOnly: false,
      handler: (i, a) => {
        const { id, ...rest } = parse(editInput, i);
        return p.updatePrinciple(d, a, idParam(id), rest);
      },
    },
    {
      name: "delete_principle",
      description:
        "현재 원칙을 삭제하고 최종 메모를 기록한다. 과거 원칙을 자동 승격하지 않는다. 기존 보존 자료는 남는다.",
      input: remove,
      readOnly: false,
      destructive: true,
      handler: async (i, a) => {
        const v = parse(removeInput, i);
        const target = idParam(v.id);
        await p.deletePrinciple(d, a, target, v.expected_version, v.change_note);
        return { deleted: target };
      },
    },
    {
      name: "get_principle",
      description: "현재 원칙의 원문과 저장 메모 조회. 과거 자료는 보존된 기록에서 확인한다.",
      input: z.strictObject({ id }),
      readOnly: true,
      handler: (i, a) => p.getPrinciple(d, a, idParam(parse(get, i).id)),
    },
  ];
}
