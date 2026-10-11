// 공개 설정만 소비한다. 주소에 자격 증명·검색 매개변수·fragment를 허용하지 않는다.
function publicUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export function guideConfig(apiUrl?: string, repositoryUrl?: string, pluginUrl?: string) {
  const api = publicUrl(apiUrl);
  let mcp: string | null = null;
  if (api && /\/api\/?$/.test(api.pathname)) {
    api.pathname = api.pathname.replace(/\/api\/?$/, "/mcp");
    mcp = api.href;
  }
  const repository = publicUrl(repositoryUrl);
  const base = repository?.href.replace(/\/$/, "");
  const plugin = publicUrl(pluginUrl);
  return {
    mcp,
    pluginApp: plugin?.protocol === "https:" ? plugin.href : null,
    pluginDocs: base ? `${base}/blob/HEAD/plugins/workspace/README.md` : null,
    releaseDocs: base ? `${base}/blob/HEAD/docs/deployment/release.md#플러그인-패키징과-배포` : null,
  };
}
