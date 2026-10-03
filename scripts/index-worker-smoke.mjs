// 명시적으로 실행하는 유료 공급자 검증. CI에서는 실행하지 않으며 시험 원본 3개만 처리한다.
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
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
    const body = `본문 전용 표식 ${crypto.randomUUID()}`;
    const item = await api("POST", `/${kind}s`, { title: "임베딩 시험", summary: "서버 오류를 점검하고 복구 절차를 기록했다.",
      body, ...(kind === "task" ? { kind: "once" } : {}) });
    const cleanup = { kind, id: item.id, version: 1 }; originals.push(cleanup);
    const result = await work(kind, item.id);
    if (result.indexed !== 1) throw new Error(`${kind} 실제 임베딩이 완료되지 않았습니다`);
    const [state] = await sql`select state,pipeline,extensions.vector_dims(embedding) as dimension from app.search_index_state
      where owner_id=${user.id} and kind=${kind} and id=${item.id}`;
    if (state.state !== "indexed" || state.dimension !== 1024 || state.pipeline !== "llama-v2-1024-title-summary-v1") {
      throw new Error(`${kind} 현재 벡터 검증 실패`);
    }
    const read = await api("GET", `/${kind}s/${item.id}`);
    if (read.body !== body) throw new Error("원문이 변경됐습니다");
    const changed = await api("PATCH", `/${kind}s/${item.id}`, { expected_version: 1, body: `${body}\n본문만 수정` });
    cleanup.version = changed.version;
    if ((await work(kind, item.id)).claimed !== 0) throw new Error("본문 수정으로 재임베딩이 등록됐습니다");
    console.log(`${kind}: 실제 Pinecone → 1024차원 현재 벡터, 원문 보존, 본문 재임베딩 억제 통과`);
  }
} finally {
  for (const { kind, id, version } of originals) await api("DELETE", `/${kind}s/${id}?expected_version=${version}`);
  await sql.end();
}
