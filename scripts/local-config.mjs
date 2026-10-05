import { readFileSync } from "node:fs";
import { parse } from "smol-toml";

// 로컬 실행의 정본은 Supabase 설정이다. 운영 remote 값은 사용하지 않는다.
export function readLocalConfig(file = new URL("../supabase/config.toml", import.meta.url)) {
  const config = parse(readFileSync(file, "utf8"));
  const port = (value) => {
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw Error("로컬 설정의 포트가 유효하지 않습니다");
    return value;
  };
  const projectId = config.project_id;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId)) throw Error("로컬 project_id가 유효하지 않습니다");
  const web = new URL(config.auth?.site_url);
  if (web.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(web.hostname) || web.username || web.password) {
    throw Error("로컬 auth.site_url은 loopback HTTP 주소여야 합니다");
  }
  const webPort = port(Number(web.port || 80));
  const origins = [web.origin, ...(config.auth.additional_redirect_urls ?? []).flatMap((address) => {
    try {
      const url = new URL(address);
      return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && !url.username && !url.password ? [url.origin] : [];
    } catch { return []; }
  })];
  if (config.db?.pooler?.enabled !== true) throw Error("로컬 트랜잭션 풀러를 켜야 합니다");
  return {
    projectId, apiUrl: `http://127.0.0.1:${port(config.api?.port)}`,
    poolerPort: port(config.db.pooler.port), webUrl: web.origin, webPort,
    webOrigins: [...new Set(origins)].join(","),
  };
}
