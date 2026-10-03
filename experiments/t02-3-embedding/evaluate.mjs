import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { bodyOnly, boundaries, calibration, documents, validation } from "./fixtures.mjs";

export const API_VERSION = "2026-07";
const DIMENSION = 1024;
const headers = () => ({
  "Api-Key": process.env.PINECONE_API_KEY,
  "X-Pinecone-Api-Version": API_VERSION,
  "Content-Type": "application/json",
});

async function request(path, payload) {
  const res = await fetch(`https://api.pinecone.io${path}`, {
    method: payload ? "POST" : "GET",
    headers: headers(),
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  // 사용자 값·비밀·원격 응답 원문은 오류 로그에 넣지 않는다. 자동 재시도로 비용을 늘리지 않는다.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error?.message ?? body.message ?? "";
    const category = errorCategory(res.status, message);
    throw Object.assign(new Error(`Pinecone HTTP ${res.status} (${category})`), { status: res.status, category });
  }
  return await res.json();
}

export function errorCategory(status, message) {
  return status === 400 && /exceed|too.*long|token.*limit|maximum.*(sequence|token)|tokens were truncated|max length per sequence/i.test(message)
    ? "input_limit" : "other";
}

export function validateVectors(response, model, count) {
  if (response.model !== model || response.vector_type !== "dense" || response.data?.length !== count) {
    throw new Error("모델·벡터 종류·개수가 요청과 다릅니다");
  }
  return response.data.map((item) => {
    if (item.vector_type !== "dense" || item.values?.length !== DIMENSION ||
      !item.values.every(Number.isFinite) || item.values.every((v) => v === 0)) {
      throw new Error("유효한 1024차원 dense 벡터가 아닙니다");
    }
    return item.values;
  });
}

export function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] ** 2; normB += b[i] ** 2;
  }
  return dot / Math.sqrt(normA * normB);
}

export function chooseThreshold(rows) {
  const positive = rows.filter((r) => r.relevant !== null);
  const negative = rows.filter((r) => r.relevant === null);
  const minimumRelevant = Math.min(...positive.map((r) => r.expected_score));
  const maximumUnrelated = Math.max(...negative.map((r) => r.top[0].score));
  const separable = positive.every((r) => r.top[0].id === r.relevant) && minimumRelevant > maximumUnrelated;
  const midpoint = (minimumRelevant + maximumUnrelated) / 2;
  const rounded = Math.round(midpoint * 100) / 100;
  return { minimumRelevant, maximumUnrelated, separable,
    threshold: separable ? (rounded > maximumUnrelated && rounded <= minimumRelevant ? rounded : midpoint) : null };
}

function scoreRows(queries, vectors, passageVectors) {
  return queries.map((q, i) => {
    const ranked = documents.map((d, j) => ({ id: d.id, score: cosine(vectors[i], passageVectors[j]) }))
      .sort((a, b) => b.score - a.score);
    return { ...q, expected_score: q.relevant ? ranked.find((r) => r.id === q.relevant).score : null,
      top: ranked.slice(0, 3) };
  });
}

async function evaluate(model) {
  const metadata = await request(`/models/${model}`);
  if (metadata.vector_type !== "dense" ||
    !(metadata.supported_dimensions ?? [metadata.default_dimension]).includes(DIMENSION)) {
    throw new Error("모델 metadata가 후보 차원과 일치하지 않습니다");
  }
  const truncation = metadata.supported_parameters?.find((p) => p.parameter === "truncate");
  if (!truncation?.allowed_values?.includes("NONE")) throw new Error("절단 거부 설정을 지원하지 않습니다");
  let tokens = 0;
  let calls = 1;
  const embed = async (texts, inputType) => {
    if (texts.length > metadata.max_batch_size) throw new Error("평가 입력이 모델 배치 한도를 넘습니다");
    const parameters = { input_type: inputType, truncate: "NONE" };
    if (metadata.supported_parameters.some((p) => p.parameter === "dimension")) parameters.dimension = DIMENSION;
    calls++;
    const response = await request("/embed", { model, inputs: texts.map((text) => ({ text })), parameters });
    tokens += response.usage?.total_tokens ?? 0;
    return { vectors: validateVectors(response, model, texts.length), tokens: response.usage?.total_tokens ?? null };
  };
  const passages = await embed(documents.map((d) => `${d.title}\n${d.summary}`), "passage");
  const queries = [...calibration, ...validation, ...bodyOnly];
  const embeddedQueries = await embed(queries.map((q) => q.query), "query");
  const rows = scoreRows(queries, embeddedQueries.vectors, passages.vectors);
  const fitted = chooseThreshold(rows.slice(0, calibration.length));
  const heldOut = rows.slice(calibration.length, calibration.length + validation.length);
  const validationPassed = fitted.separable && heldOut.every((r) => r.relevant
    ? r.top[0].id === r.relevant && r.expected_score >= fitted.threshold
    : r.top[0].score < fitted.threshold);
  const boundaryResults = [];
  for (const b of boundaries) {
    try {
      const result = await embed([b.text], b.inputType ?? "passage");
      boundaryResults.push({ name: b.name, code_points: [...b.text].length,
        utf8_bytes: Buffer.byteLength(b.text), accepted: true, tokens: result.tokens });
    } catch (e) {
      if (e.status !== 400) throw e;
      boundaryResults.push({ name: b.name, code_points: [...b.text].length,
        utf8_bytes: Buffer.byteLength(b.text), accepted: false, status: e.status, category: e.category });
    }
  }
  // 공급자 상한을 넘는 입력은 한 번만 시험한다. truncate:NONE의 400 거부를 확인한다.
  let overflowRejected = false;
  try { await embed(["가".repeat(10_000)], "passage"); }
  catch (e) { if (e.status !== 400 || e.category !== "input_limit") throw e; overflowRejected = true; }
  const details = rows.slice(-bodyOnly.length).map((r) => ({ ...r,
    keyword_hit: documents.find((d) => d.id === r.relevant).body.includes(r.query),
    semantic_hit: fitted.threshold !== null && r.top[0].id === r.relevant && r.expected_score >= fitted.threshold,
  }));
  return { model, dimension: DIMENSION, metadata, calibration: rows.slice(0, calibration.length),
    fitted, validation: heldOut, validationPassed, body_only: details,
    boundaries: boundaryResults, overflowRejected, calls, total_tokens: tokens,
    acceptable: validationPassed && boundaryResults.every((b) => b.accepted) && overflowRejected };
}

export async function main() {
  if (!process.env.PINECONE_API_KEY) throw new Error("실험 .env.local에 PINECONE_API_KEY를 설정하세요");
  const results = [];
  for (const model of ["llama-text-embed-v2", "multilingual-e5-large"]) {
    console.log(`평가 시작: ${model}`);
    const result = await evaluate(model);
    results.push(result);
    console.log(`${model}: 검증=${result.validationPassed}, 입력경계=${result.boundaries.every((b) => b.accepted)}, 상한거부=${result.overflowRejected}, tokens=${result.total_tokens}`);
    // 중단되더라도 완료된 모델의 결과는 남긴다. 벡터와 비밀은 저장하지 않는다.
    writeFileSync(new URL("results.local.json", import.meta.url), JSON.stringify({
      generated_at: new Date().toISOString(), api_version: API_VERSION, results,
      fixtures_sha256: createHash("sha256").update(JSON.stringify({ documents, calibration, validation, bodyOnly, boundaries })).digest("hex"),
    }, null, 2) + "\n");
  }
  if (!results[0].acceptable) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
