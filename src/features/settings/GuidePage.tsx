import { useState } from "react";
import { Link } from "react-router";
import { guideConfig } from "./guide-config.ts";

export function GuidePage() {
  const config = guideConfig(import.meta.env.VITE_API_URL, import.meta.env.VITE_REPOSITORY_URL);
  const [copied, setCopied] = useState("");
  return <section className="panel guide" aria-labelledby="guide-title">
    <h1 className="page-title" id="guide-title">사용 가이드</h1>
    <p>엔터티에 할 일과 기록을 연결하고, 에이전트와 검색한 뒤 결과를 웹에서 확인하세요.</p>
    <ol className="guide-steps">
      <li className="guide-step"><h2 className="item-title">엔터티 하나 만들기</h2>
        <p>진행 중인 프로젝트처럼 관리할 대상을 엔터티로 등록하세요. 이 템플릿은 속성 1~4를 가진 간단한 예제입니다.</p>
        <Link className="btn" to="/entities">엔터티로 이동</Link></li>
      <li className="guide-step"><h2 className="item-title">할 일 또는 기록 작성하기</h2>
        <p>앞으로 할 일은 할 일에, 수행한 일과 결과는 기록에 남기세요. 연결 엔터티는 선택 사항이므로 엔터티 없이도 시작할 수 있습니다.</p>
        <div className="actions"><Link className="btn" to="/tasks">할 일로 이동</Link><Link className="btn" to="/records">기록으로 이동</Link></div></li>
      <li className="guide-step"><h2 className="item-title">제품 플러그인 연결하기</h2>
        <p>Claude와 Codex용 제품 플러그인은 MCP 연결 설정과 제품 스킬을 함께 제공합니다. MCP OAuth 로그인은 데이터 접근을 허용하고, 제품 스킬은 검색·읽기·저장 방법을 안내합니다. 로그인만으로 스킬 설치가 끝나는 것은 아닙니다.</p>
        <details className="workspace-additional"><summary>설치·연결 정보</summary><div className="search-advanced">
        {config.mcp ? <div className="field">
          <label className="label" htmlFor="guide-mcp">이 앱의 MCP 연결 주소</label>
          <input className="input" id="guide-mcp" readOnly value={config.mcp} onFocus={event => event.currentTarget.select()} />
          <button type="button" className="btn" onClick={async () => {
            try { await navigator.clipboard.writeText(config.mcp!); setCopied("연결 주소를 복사했습니다."); }
            catch { setCopied("복사하지 못했습니다. 위 주소를 선택해 직접 복사하세요."); }
          }}>연결 주소 복사</button>
          <p className="secondary" role="status">{copied}</p>
        </div> : <p className="notice">연결 주소가 설정되지 않았습니다. 앱 관리자에게 이 앱의 MCP 주소와 제품 플러그인을 요청하세요.</p>}
        {config.pluginDocs ? <p><a className="back-link" href={config.pluginDocs}>Claude Code·Codex CLI 설치와 업데이트 안내</a><br />
          <a className="back-link" href={config.releaseDocs!}>플러그인 배포와 클라이언트 검증 기준</a></p>
          : <p className="secondary">설치 문서가 설정되지 않았습니다. 앱 관리자에게 이 앱의 제품 플러그인 설치 안내를 요청하세요. 클라이언트마다 설치·스킬 선택·OAuth 연결을 따로 확인하세요.</p>}
        <p className="secondary">CLI 설치의 desktop 반영과 웹·모바일 지원은 별도 검증이 필요합니다. 사용하는 클라이언트의 지원 범위는 연결된 설치 안내에서 확인하세요.</p></div></details></li>
      <li className="guide-step"><h2 className="item-title">검색한 뒤 원문 읽기</h2>
        <p>에이전트에게 “내 기록에서 관련 내용을 찾아 원문을 읽고 요약해줘”처럼 요청하세요. 검색 결과의 일치 구간을 보고 원문 전체를 확인합니다. 새로 저장한 내용은 색인 처리 전까지 의미 검색에 늦게 나타날 수 있습니다.</p>
        <Link className="btn" to="/search">웹 검색으로 이동</Link></li>
      <li className="guide-step"><h2 className="item-title">저장을 명시하고 웹에서 확인하기</h2>
        <p>대화의 제안은 자동으로 저장되지 않습니다. 남길 결과는 “이 내용을 기록으로 저장해줘”처럼 명시하세요. 에이전트의 저장 결과를 확인한 뒤 웹에서 기록 본문을 다시 읽으세요.</p>
        <Link className="btn" to="/records">저장한 기록 확인</Link></li>
    </ol>
  </section>;
}
