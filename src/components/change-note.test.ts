import { describe, expect, it } from "vitest";
import { changeNoteErrors } from "./change-note.ts";
describe("change note boundary",()=>{
  it("requires meaningful edit reasons without making creation reasons mandatory",()=>{
    expect(changeNoteErrors(" \n ",true)).toEqual({change_note:"편집 메모를 입력하세요."});
    expect(changeNoteErrors("",false)).toBeNull();
    expect(changeNoteErrors("명시한 이유",true)).toBeNull();
  });
  it("counts Unicode code points consistently with the server",()=>{
    expect(changeNoteErrors("😀".repeat(1000),true)).toBeNull();
    expect(changeNoteErrors("😀".repeat(1001),true)?.change_note).toContain("1,000");
  });
});
