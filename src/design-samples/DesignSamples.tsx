import { type CSSProperties, useRef, useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
import { Field, Notice } from "../components/Field.tsx";
import { MaterialSettingsSection } from "../features/settings/MaterialSettingsSection.tsx";
import { MaterialWorkspaceSample } from "./PropertySamples.tsx";
import { ModalSamples } from "./ModalSamples.tsx";
import { TagSamples } from "./TagSamples.tsx";

const topics = [["buttons", "버튼"], ["forms", "폼과 상태"], ["tags", "태그"], ["workspace", "목록과 자료 설정"], [
  "dialogs",
  "모달과 확인",
]] as const;

/** A separate HTML entry imports presentation only: no App, Auth or API client. */
export function DesignSamples() {
  const content = new URLSearchParams(location.search).get("content") === "1";
  return content ? <SamplesContent /> : <SamplesPreview />;
}

function SamplesPreview() {
  const [width, setWidth] = useState("auto");
  const frame = useRef<HTMLIFrameElement>(null);
  const contentUrl = new URL("./index.html?content=1", location.href).href;
  return (
    <div className="samples-preview">
      <header className="samples-preview-header">
        <div>
          <h1 className="page-title">디자인 샘플</h1>
          <p className="secondary">직접 눌러보세요. 모든 변경은 예시 데이터에만 반영됩니다.</p>
        </div>
        <div className="actions" role="group" aria-label="미리보기 화면 폭">
          {[["auto", "현재 화면"], ["390", "모바일"], ["1280", "데스크톱"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="btn"
              aria-pressed={width === value}
              onClick={() => setWidth(value)}
            >
              {label}
            </button>
          ))}
          <a className="btn btn-text" href={contentUrl} target="_blank" rel="noreferrer">샘플만 열기 ↗</a>
        </div>
      </header>
      <nav className="samples-topics" aria-label="샘플 바로가기">
        {topics.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn btn-text"
            onClick={() => frame.current?.contentDocument?.getElementById(id)?.scrollIntoView()}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="samples-preview-space">
        <iframe
          ref={frame}
          title="직접 조작하는 디자인 샘플"
          src={contentUrl}
          style={{ width: width === "auto" ? "100%" : `${width}px` } as CSSProperties}
        />
      </div>
    </div>
  );
}

function SamplesContent() {
  return (
    <main className="samples-content">
      <header>
        <p className="meta">WORKSPACE · DESIGN SAMPLES</p>
        <h1 className="page-title">같은 역할, 같은 문법</h1>
        <p className="secondary">
          앱의 공용 스타일과 컴포넌트로 만든 예시입니다. 로그인이나 서버 연결 없이 조작할 수 있습니다.
        </p>
      </header>
      <section id="buttons" className="samples-topic" aria-labelledby="buttons-title">
        <h2 id="buttons-title" className="page-title">버튼</h2>
        <p className="secondary">입력 옆 조작은 입력과 크기를 맞추고, 독립적인 보조 행동은 가볍게 표시합니다.</p>
        <ButtonSamples />
      </section>
      <section id="forms" className="samples-topic" aria-labelledby="forms-title">
        <h2 id="forms-title" className="page-title">폼과 상태</h2>
        <p className="secondary">필수 입력, 도움말, 오류, 읽기 전용과 비활성을 비교해보세요.</p>
        <FormSamples />
      </section>
      <section id="tags" className="samples-topic" aria-labelledby="tags-title">
        <h2 id="tags-title" className="page-title">태그</h2>
        <p className="secondary">태그를 눌러 선택하거나 해제하세요. 전체 해제는 라벨 옆의 보조 행동입니다.</p>
        <TagSamples />
      </section>
      <section id="workspace" className="samples-topic" aria-labelledby="workspace-title">
        <h2 id="workspace-title" className="page-title">목록과 자료 설정</h2>
        <p className="secondary">
          입력 항목을 수정하고 변경 검토를 눌러보세요. 이력에는 당시 입력 항목과 변경 결과가 표시됩니다.
        </p>
        <MaterialWorkspaceSample />
      </section>
      <section id="dialogs" className="samples-topic" aria-labelledby="dialogs-title">
        <h2 id="dialogs-title" className="page-title">모달과 확인</h2>
        <p className="secondary">편집과 실행 확인은 다른 단계입니다. 실패와 결과 미확정도 직접 확인할 수 있습니다.</p>
        <ModalSamples />
      </section>
      <footer className="samples-content-footer secondary">
        시각 값의 기준은 시각 규격, 동작의 기준은 UI 패턴 문서입니다. 샘플은 실제 업무 자료를 저장하지 않습니다.
      </footer>
    </main>
  );
}

function ButtonSamples() {
  const [types, setTypes] = useState(["상품", "재료"]);
  const [type, setType] = useState("상품");
  const [options, setOptions] = useState(["판매 중"]);
  const [message, setMessage] = useState("");
  return (
    <div className="samples-stack">
      <div className="material-settings-toolbar">
        <Field label="자료 종류 선택">
          {(props) => (
            <select
              {...props}
              className="input"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {types.map((value) => <option key={value}>{value}</option>)}
            </select>
          )}
        </Field>
        <button
          type="button"
          className="btn btn-input"
          onClick={() => {
            const next = `새 종류 ${types.length - 1}`;
            setTypes([...types, next]);
            setType(next);
            setMessage("새 종류가 예시 목록에 추가됐습니다.");
          }}
        >
          종류 추가
        </button>
      </div>
      <div className="settings">
        <MaterialSettingsSection title="입력 옆 조작과 섹션 푸터" summary="선택 항목" initialOpen>
          <div className="settings-fields">
            {options.map((value, index) => (
              <div className="schema-option-row" key={index}>
                <Field label={`선택 항목 ${index + 1}`}>
                  {(props) => (
                    <input
                      {...props}
                      className="input"
                      value={value}
                      onChange={(event) =>
                        setOptions(options.map((prior, i) => i === index ? event.target.value : prior))}
                    />
                  )}
                </Field>
                <button
                  type="button"
                  className="btn btn-input"
                  aria-label={`선택 항목 ${index + 1} 제거`}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                >
                  제거
                </button>
              </div>
            ))}
            <div>
              <BodyAction icon="create" onClick={() => setOptions([...options, `새 선택 항목 ${options.length + 1}`])}>
                항목 추가
              </BodyAction>
            </div>
          </div>
          <div className="settings-section-footer">
            <div className="actions schema-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setOptions(["판매 중"]);
                  setMessage("예시 입력을 되돌렸습니다.");
                }}
              >
                변경 취소
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setMessage("예시 입력을 저장했습니다.")}>
                저장
              </button>
            </div>
          </div>
        </MaterialSettingsSection>
      </div>
      <div>
        <BodyAction
          icon="reset"
          onClick={() => {
            setTypes(["상품", "재료"]);
            setType("상품");
            setOptions(["판매 중"]);
            setMessage("예시를 처음 상태로 되돌렸습니다.");
          }}
        >
          예시 초기화
        </BodyAction>
        <BodyAction
          danger
          icon="unlink"
          onClick={() => setMessage("위험 행동은 명확한 이름과 위험 색으로 표시합니다.")}
        >
          연결 해제 예시
        </BodyAction>
        <BodyAction disabled icon="create">권한 없는 조작</BodyAction>
      </div>
      <p className="secondary samples-status" role="status">
        {message || "종류 추가·항목 추가·제거·저장을 눌러 크기와 배치를 비교해보세요."}
      </p>
    </div>
  );
}

function FormSamples() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        const invalid = !name.trim();
        setError(invalid ? "상품명을 입력하세요." : "");
        setSaved(!invalid);
        if (invalid) event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      }}
      noValidate
    >
      <Field label="상품명" required help="목록에서 알아볼 수 있는 이름을 입력하세요." error={error}>
        {(props) => (
          <input
            {...props}
            className="input"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            placeholder="예: 유리컵"
          />
        )}
      </Field>
      <div className="samples-form-pair">
        <Field label="읽기 전용" help="내용을 읽고 복사할 수 있습니다.">
          {(props) => <input {...props} className="input" readOnly value="상품 · 버전 2" />}
        </Field>
        <Field label="비활성" help="현재 단계에서는 조작할 수 없습니다.">
          {(props) => <input {...props} className="input" disabled value="처리 중" />}
        </Field>
      </div>
      <dl className="props samples-values">
        <div>
          <dt>수량</dt>
          <dd>0</dd>
        </div>
        <div>
          <dt>설명</dt>
          <dd>설정 안 함</dd>
        </div>
        <div>
          <dt>긴 이름</dt>
          <dd>공백없는아주긴상품이름도글자크기를줄이지않고자연스럽게줄바꿈합니다</dd>
        </div>
      </dl>
      <div className="actions schema-actions">
        <button className="btn btn-primary" type="submit">입력 확인</button>
      </div>
      {saved && <Notice kind="success">입력 조건을 충족합니다.</Notice>}
    </form>
  );
}
