import { expect, test } from "vitest";
import { readApiKey } from "./read-api-key.ts";

test("보호된 상태 읽기는 같은 API를 재사용하지만 계정·공간 전환 어댑터와 세션 교체를 구별한다", () => {
  const originalApi = () => Promise.resolve();
  const otherWorkspaceApi = () => Promise.resolve();
  const renewedSessionApi = () => Promise.resolve();
  const originalKey = readApiKey(originalApi);
  expect(readApiKey(originalApi)).toBe(originalKey);
  expect(readApiKey(otherWorkspaceApi)).not.toBe(originalKey);
  expect(readApiKey(renewedSessionApi)).not.toBe(originalKey);
  expect(readApiKey(otherWorkspaceApi)).not.toBe(readApiKey(renewedSessionApi));
});
