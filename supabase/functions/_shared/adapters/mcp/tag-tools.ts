import { tagConnectionInput } from "../../contracts/tag-connection.ts";
import { z } from "zod";
import { expectedVersion, id } from "../../contracts/common.ts";
import { mutationMeta } from "../../contracts/change.ts";
import { tagCreate, tagIds, tagListQuery, tagRename } from "../../contracts/tag.ts";
import * as tags from "../../core/tags/application.ts";
import { parse } from "../errors.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function tagTools(d: tags.TagDeps): ToolDef[] {
  const rename = tagRename.extend({ id }),
    remove = z.strictObject({ id, expected_version: expectedVersion, ...mutationMeta });
  const tools: ToolDef[] = [
    {
      name: "set_tag_connections",
      description:
        "저장된 대상의 태그 연결만 독립 교체·해제한다. 현재 expected_version과 같은 공간·태그 범위 및 대상 쓰기 권한을 검사한다. 자료·할 일의 연결 변경은 자동 변경 기록과 원자 저장하며 기록 태그에는 추가 편집 로그가 없다. 내용 생성·수정의 tag_ids는 받지 않는다.",
      input: z.strictObject({
        target_kind: z.enum(["entity", "task", "record"]),
        target_id: z.string().min(1).max(600),
        expected_version: expectedVersion,
        tag_ids: tagIds,
        ...mutationMeta,
      }),
      inputVariants: tagConnectionInput.options,
      readOnly: false,
      handler: (input, actor) => tags.setTagConnections(d, actor, parse(tagConnectionInput, input)),
    },
    {
      name: "list_tags",
      description:
        "scope entity/task/record 별 태그 목록. 생략은 record. purpose=record-template은 설정 읽기 권한으로 기록 문구용 태그 이름·ID 메타데이터만 조회하며 record scope만 허용한다. next_cursor가 없을 때까지 조회한다.",
      input: tagListQuery,
      readOnly: true,
      handler: (i, a) => tags.listTags(d, a, parse(tagListQuery, i)),
    },
    {
      name: "create_tag",
      description:
        "태그 생성. scope entity/task/record, 생략은 record. 이름 1~30자, 현재 공간과 scope 안에서 대소문자 무시 고유. 내부 id는 성공 응답으로 반환한다.",
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
        "태그 삭제와 부모 연결 해제를 원자 저장. 원문 보존, 부모별 변경 기록 하나, 선택 메모. 태그 자체 사건과 자동 기록의 재귀는 없다.",
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
  return tools.map((tool) => tool.readOnly || tool.name.startsWith("prepare_") ? tool : keyedTool(tool));
}
