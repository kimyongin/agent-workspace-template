import { useState } from "react";
import { Link } from "react-router";
import { guideConfig } from "./guide-config.ts";

export function GuidePage() {
  const config = guideConfig(import.meta.env.VITE_API_URL, import.meta.env.VITE_REPOSITORY_URL, import.meta.env.VITE_PLUGIN_URL);
  const [copied, setCopied] = useState("");
  return <section className="panel guide" aria-labelledby="guide-title">
    <h1 className="page-title" id="guide-title">사용 가이드</h1>
    <p>자료에 할 일과 기록을 연결하고, 에이전트와 검색한 뒤 결과를 웹에서 확인하세요.</p>
    <ol className="guide-steps">
      <li className="guide-step"><h2 className="item-title">자료 하나 만들기</h2>
        <p>진행 중인 프로젝트처럼 관리할 대상을 자료로 등록하세요. 먼저 자료 종류를 만들고 이름·수량·날짜처럼 필요한 속성을 정하세요. 각 자료는 선택한 종류의 정의에 따라 저장됩니다.</p>
        <Link className="btn" to="/entities">자료로 이동</Link></li>
      <li className="guide-step"><h2 className="item-title">할 일 또는 기록 작성하기</h2>
        <p>앞으로 할 행동은 할 일에, 메모·참고 자료는 기록에 남기세요. 연결 자료는 선택 사항이므로 자료 없이도 시작할 수 있습니다.</p>
        <ul>
          <li>일반 기록은 참고 자료입니다. 할 일에 연결해도 완료 상태는 바뀌지 않습니다.</li>
          <li>일회성 할 일을 실제로 수행했다면 상세의 ‘완료하고 기록’으로 결과와 완료를 함께 저장하세요.</li>
          <li>반복 할 일은 상세에서 수행한 날짜의 ‘회차 기록’으로 결과를 남기세요. 결과가 있는 그 날짜의 회차만 완료됩니다. 반복 업무가 자동 실행되거나 알림을 보내지는 않습니다.</li>
        </ul>
        <div className="actions"><Link className="btn" to="/tasks">할 일로 이동</Link><Link className="btn" to="/records">기록으로 이동</Link></div></li>
      <li className="guide-step"><h2 className="item-title">제품 플러그인 연결하기</h2>
        <p>Claude와 Codex용 제품 플러그인은 MCP 연결 설정과 제품 스킬을 함께 제공합니다. MCP OAuth 로그인은 데이터 접근을 허용하고, 제품 스킬은 검색·읽기·저장 방법을 안내합니다. 로그인만으로 스킬 설치가 끝나는 것은 아닙니다.</p>
        <details className="workspace-additional"><summary>설치·연결 정보</summary><div className="search-advanced">
        {config.pluginApp && <div>
          <a className="btn" href={config.pluginApp}>제품 플러그인 설치·연결 안내</a>
          <p>플러그인에 접근할 수 있는 계정으로 안내를 여세요. 사용하는 클라이언트에서 플러그인을 추가하고 제품 스킬을 확인한 뒤, 이 앱의 OAuth 연결을 완료하세요. 설치와 로그인은 각각 확인해야 합니다.</p>
          <p className="secondary">비공개 플러그인은 허용된 계정에서만 사용할 수 있습니다. 다른 클라이언트의 설치가 자동 반영된다고 가정하지 말고 앱 이름·설치 버전·스킬·연결 상태를 확인하세요.</p>
        </div>}
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
          : !config.pluginApp && <p className="secondary">설치 문서가 설정되지 않았습니다. 앱 관리자에게 이 앱의 제품 플러그인 설치 안내를 요청하세요. 클라이언트마다 설치·스킬 선택·OAuth 연결을 따로 확인하세요.</p>}
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
