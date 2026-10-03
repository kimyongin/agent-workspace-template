import { z } from "zod";
import { expectedVersion, id } from "../../contracts/common.ts";
import { tagCreate, tagListQuery, tagRename } from "../../contracts/tag.ts";
import * as tags from "../../core/tags/application.ts";
import { parse } from "../errors.ts";
import type { ToolDef } from "./tools.ts";
export function tagTools(d: tags.TagDeps): ToolDef[] {
  const rename = tagRename.extend({ id }), remove = z.strictObject({ id, expected_version: expectedVersion });
  return [
    {
      name: "list_tags",
      description: "내 태그 목록. next_cursor가 없을 때까지 조회한다.",
      input: tagListQuery,
      readOnly: true,
      handler: (i, a) => tags.listTags(d, a, parse(tagListQuery, i)),
    },
    {
      name: "create_tag",
      description: "태그 생성. 이름 1~30자, 소유자 안에서 대소문자 무시 고유. request_id 재시도 가능.",
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
      description: "태그만 삭제. 연결 항목의 원문은 보존한다.",
      input: remove,
      readOnly: false,
      destructive: true,
      handler: async (i, a) => {
        const p = parse(remove, i);
        await tags.deleteTag(d, a, p.id, p.expected_version);
        return { deleted: p.id };
      },
    },
  ];
}
