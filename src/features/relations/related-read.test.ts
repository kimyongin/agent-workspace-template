import { describe, expect, it } from "vitest";
import { createRelatedRead } from "./related-read.ts";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("연결 대상의 현재 내용 읽기", () => {
  it("행의 최초 조회와 펼침 순간의 최신 내용은 독립적으로 확인한다", async () => {
    let value = { title: "최초 제목" };
    const read = createRelatedRead({ load: async () => value });
    await read.read("probe");
    value = { title: "바뀐 제목" };
    await read.read("preview");
    expect(read.snapshot().probe.value).toEqual({ title: "최초 제목" });
    expect(read.snapshot().preview.value).toEqual({ title: "바뀐 제목" });
    read.closePreview();
    expect(read.snapshot().preview.value).toBeNull();
    expect(read.snapshot().probe.value).toEqual({ title: "최초 제목" });
  });
});

it("닫힌 펼침과 오래된 조회는 다시 열린 최신 내용을 바꾸지 않는다", async () => {
  const old = deferred<{title:string}>(), latest = deferred<{title:string}>();
  const pending = [old, latest];
  const read = createRelatedRead({ load: () => pending.shift()!.promise });
  const first = read.read("preview");
  read.closePreview();
  const second = read.read("preview");
  latest.resolve({title:"최신 내용"}); await second;
  old.resolve({title:"오래된 내용"}); await first;
  expect(read.snapshot().preview).toEqual({value:{title:"최신 내용"},error:null,loading:false});
});

it("조회 실패 후 다시 확인하면 실패를 해소하고 현재 내용을 표시한다", async () => {
  let failed = true;
  const error = new Error("조회 실패");
  const read = createRelatedRead({ load: async () => { if (failed) throw error; return {title:"조회 성공"}; } });
  await read.read("probe");
  expect(read.snapshot().probe.error).toBe(error);
  failed = false;
  await read.read("probe");
  expect(read.snapshot().probe).toEqual({value:{title:"조회 성공"},error:null,loading:false});
});

it("행이 끝나면 최초 조회와 펼침 조회를 모두 취소한다", async () => {
  const pending = deferred<string>();
  const signals:AbortSignal[]=[];
  const read = createRelatedRead({load:signal=>{signals.push(signal);return pending.promise;}});
  const probe = read.read("probe"), preview = read.read("preview");
  read.cancel();
  expect(signals.every(signal=>signal.aborted)).toBe(true);
  pending.resolve("이미 닫힌 행");await Promise.all([probe,preview]);
  expect([read.snapshot().probe.value,read.snapshot().preview.value]).toEqual([null,null]);
});
