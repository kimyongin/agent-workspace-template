// 명시적으로 실행하는 유료 공급자 검증. CI에서는 실행하지 않는다.
import postgres from "postgres";
import { readEnv } from "./local-env.mjs";
const env = readEnv(new URL("../.env.local", import.meta.url));
const endpoint = new URL(env.VITE_SUPABASE_URL);
if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname)) {
  throw new Error("이 검증은 격리된 로컬 Supabase에서만 실행합니다");
}
const login = await fetch(`${endpoint.origin}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD }),
});
if (!login.ok) throw new Error(`로컬 로그인 실패: ${login.status}`);
const { access_token: token, user } = await login.json();
const sql = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
const originals = [];
async function api(method, path, body) {
  const res = await fetch(`${endpoint.origin}/functions/v1/api${path}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
      ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`로컬 API ${method} ${path}: ${res.status}`);
  return res.status === 204 ? null : await res.json();
}
async function work(kind, id) {
  const res = await fetch(`${endpoint.origin}/functions/v1/index-worker`, {
    method: "POST", headers: { authorization: `Bearer ${env.INDEX_WORKER_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ limit: 1, owner_id: user.id, kind, id }),
  });
  if (!res.ok) throw new Error(`로컬 worker: ${res.status}`);
  return await res.json();
}
try {
  for (const kind of ["task", "record", "principle"]) {
    const body = `서버 오류를 점검하고 복구 절차를 기록했다. 본문 표식 ${crypto.randomUUID()}`;
    const item = await api("POST", `/${kind}s`, {
      ...(kind === "record" ? {} : { title: "임베딩 시험" }), body, ...(kind === "task" ? { kind: "once" } : {}) });
    const cleanup = { kind, id: item.id, version: 1 }; originals.push(cleanup);
    const result = await work(kind, item.id);
    if (kind === "record") {
      if (result.indexed !== 1) throw new Error("기록 실제 임베딩이 완료되지 않았습니다");
      const [state] = await sql`select i.state,i.pipeline,min(extensions.vector_dims(c.embedding)) as dimension
        from app.search_index_state i join app.search_chunks c on c.owner_id=i.owner_id and c.record_id=i.id and c.generation=i.generation
        where i.owner_id=${user.id} and i.kind='record' and i.id=${item.id} group by i.state,i.pipeline`;
      if (state?.state !== "indexed" || state.dimension !== 1024 || state.pipeline !== "llama-v2-1024-record-body-utf8-1800-overlap180-v1") {
        throw new Error("기록 현재 구간 벡터 검증 실패");
      }
    } else if (result.claimed !== 0) {
      throw new Error(`${kind} 최신 내용이 별도로 임베딩됐습니다`);
    }
    const read = await api("GET", `/${kind}s/${item.id}`);
    if (read.body !== body) throw new Error("원문이 변경됐습니다");
    const changed = await api("PATCH", `/${kind}s/${item.id}`, { expected_version: 1, body: `${body}\n본문만 수정` });
    cleanup.version = changed.version;
    const after = await work(kind, item.id);
    if (kind === "record" ? after.indexed !== 1 : after.claimed !== 0) throw new Error("본문 색인 갱신 범위가 다릅니다");
    console.log(`${kind}: 원문 보존·기록 본문 구간 재색인·최신 업무 벡터 없음 통과`);
  }
} finally {
  for (const { kind, id, version } of originals) {
    if (kind === "record") await api("DELETE", `/records/${id}?expected_version=${version}`);
    else await api("POST", `/${kind}s/${id}/delete`, { expected_version: version });
  }
  await sql.end();
}
