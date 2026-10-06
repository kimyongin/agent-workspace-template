import { TEXT_LIMITS, codePointLength } from "@contracts/common.ts";
export function changeNoteErrors(value: string | null | undefined, required=false): Record<string,string> | null {
  const note=(value??"").trim();
  if(required&&!note)return {change_note:"편집 메모를 입력하세요."};
  if(codePointLength(note)>TEXT_LIMITS.body.max)return {change_note:`편집 메모는 ${TEXT_LIMITS.body.max.toLocaleString("ko-KR")}자 이하로 입력하세요.`};
  return null;
}
