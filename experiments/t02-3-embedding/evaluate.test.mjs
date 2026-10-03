import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseThreshold, cosine, errorCategory, validateVectors } from "./evaluate.mjs";
import { boundaries, calibration, documents, validation } from "./fixtures.mjs";

test("입력 한도 거부를 잘못된 모델·인증·일반 400 오류와 구분한다", () => {
  assert.equal(errorCategory(400, "Truncation is set to 'NONE' but 7957 tokens were truncated across all input sequences. Max length per sequence is 2048 tokens"), "input_limit");
  assert.equal(errorCategory(400, "Unknown model"), "other");
  assert.equal(errorCategory(401, "input exceeds limit"), "other");
});

test("응답 모델·종류·개수·차원·비유한 수치·영벡터를 검증한다", () => {
  const response = { model: "test", vector_type: "dense", data: [{ vector_type: "dense", values: Array(1024).fill(0.1) }] };
  assert.equal(validateVectors(response, "test", 1).length, 1);
  for (const changed of [
    { ...response, model: "other" }, { ...response, vector_type: "sparse" },
    { ...response, data: [] },
    { ...response, data: [{ vector_type: "dense", values: [1, 2] }] },
    { ...response, data: [{ vector_type: "dense", values: Array(1024).fill(NaN) }] },
    { ...response, data: [{ vector_type: "dense", values: Array(1024).fill(0) }] },
  ]) assert.throws(() => validateVectors(changed, "test", 1));
});

test("유사도 범위와 무관 질문 분리가 안 되는 평가의 채택 거부", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  const positive = { relevant: "a", expected_score: 0.8, top: [{ id: "a", score: 0.8 }] };
  const negative = { relevant: null, top: [{ id: "b", score: 0.2 }] };
  assert.equal(chooseThreshold([positive, negative]).threshold, 0.5);
  assert.equal(chooseThreshold([positive, { ...negative, top: [{ id: "b", score: 0.9 }] }]).threshold, null);
  assert.equal(chooseThreshold([{ ...positive, top: [{ id: "b", score: 0.9 }] }, negative]).threshold, null);
});

test("평가 자료의 문자 경계와 임계값 보정/검증 분리를 유지한다", () => {
  for (const b of boundaries) {
    if (b.inputType === "query") assert.equal([...b.text].length, 200);
    else {
      const [title, summary] = b.text.split("\n");
      assert.equal([...title].length, 100);
      assert.equal([...summary].length, 300);
    }
  }
  const calibrationQueries = new Set(calibration.map((q) => q.query));
  assert.ok(validation.every((q) => !calibrationQueries.has(q.query)));
  assert.ok([...calibration, ...validation].every((q) => q.relevant === null || documents.some((d) => d.id === q.relevant)));
});
