export function changeNoteErrors(value: string | null | undefined, required=false): Record<string,string> | null {
  const note=(value??"").trim();
  if(required&&!note)return {change_note:"편집 메모를 입력하세요."};
  if(Array.from(note).length>1000)return {change_note:"편집 메모는 1,000자 이하로 입력하세요."};
  return null;
}
