import { z } from "zod";
import { expectedVersion, id } from "../../contracts/common.ts";
import { mutationMeta } from "../../contracts/change.ts";
import { tagCreate, tagListQuery, tagRename } from "../../contracts/tag.ts";
import * as tags from "../../core/tags/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function tagTools(d: tags.TagDeps): ToolDef[] {
  const rename = tagRename.extend({ id }),
    remove = z.strictObject({ id, expected_version: expectedVersion, ...mutationMeta });
  return [
    {
      name: "list_tags",
      description: "scope entity/task/record 별 내 태그 목록. 생략은 record, next_cursor가 없을 때까지 조회한다.",
      input: tagListQuery,
      readOnly: true,
      handler: (i, a) => tags.listTags(d, a, parse(tagListQuery, i)),
    },
    {
      name: "create_tag",
      description:
        "태그 생성. scope entity/task/record, 생략은 record. 이름 1~30자, 소유자와 scope 안에서 대소문자 무시 고유. allocate_data_id로 예약한 id 필수. 같은 id 재시도는 충돌로 거부한다.",
      input: tagCreate,
      readOnly: false,
      handler: (i, a) => tags.createTag(d, a, parse(tagCreate, i)),
    },
    {
      name: "rename_tag",
      description: "태그 이름 정정. expected_version 불일치는 conflict.",
      input: rename,
      readOnly: false,
      handler: (i, a) => {
        const { id, ...rest } = parse(rename, i);
        return tags.renameTag(d, a, id, rest);
      },
    },
    {
      name: "delete_tag",
      description:
        "태그 삭제와 부모 연결 해제를 원자 저장. 원문 보존, 부모별 변경 기록 하나, 선택 메모. 같은 id·버전 재시도는 충돌 또는 없음으로 거부한다. 태그 자체 사건과 자동 기록의 재귀는 없다.",
      input: remove,
      readOnly: false,
      destructive: true,
      handler: async (i, a) => {
        const p = parse(remove, i);
        await tags.deleteTag(d, a, p.id, p.expected_version, p.change_note, p.change_tag_ids);
        return { deleted: p.id };
      },
    },
  ];
}
