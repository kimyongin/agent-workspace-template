import { DataFields } from "@/components/DataFields";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx";
import { FieldGroup, FieldSet, FieldLegend } from "../components/ui/field.tsx";
import { PlusIcon, RotateCcwIcon, UnlinkIcon } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { Input } from "../components/ui/input.tsx";
import { RelationSettingsSample } from "./RelationSettingsSample.tsx";
import { type CSSProperties, useRef, useState } from "react";

import { Field, Notice } from "../components/Field.tsx";
import { MaterialSettingsSection } from "../features/settings/MaterialSettingsSection.tsx";
import { MaterialWorkspaceSample } from "./PropertySamples.tsx";
import { ModalSamples } from "./ModalSamples.tsx";
import { FilterSamples } from "./FilterSamples.tsx";
import { TagSamples } from "./TagSamples.tsx";
import { TimezoneSelect } from "../components/TimezoneSelect.tsx";
import { RecordActionsSample } from "./RecordActionsSample.tsx";
import { IssuerSettingsSample } from "./IssuerSettingsSample.tsx";
import { AccountSettingsSample } from "./AccountSettingsSample.tsx";

const topics = [
  ["settings", "기본 설정"],
  ["issuers", "번호 출처"],
  ["relations", "자료 관계"],
  ["record-actions", "기록 설정"],
  ["buttons", "버튼"],
  ["forms", "폼과 상태"],
  ["filters", "필터"],
  ["tags", "태그"],
  ["workspace", "목록과 자료 설정"],
  [
    "dialogs",
    "모달과 확인",
  ],
] as const;

/** A separate HTML entry imports presentation only: no App, Auth or API client. */
export function DesignSamples() {
  const params = new URLSearchParams(location.search);
  if (params.get("screen") === "settings") {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-8 p-4 sm:p-8">
        <AccountSettingsSample standalone />
      </main>
    );
  }
  if (params.get("screen") === "relations") {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-8 p-4 sm:p-8">
        <RelationSettingsSample standalone />
      </main>
    );
  }
  if (params.get("screen") === "issuers") {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-8 p-4 sm:p-8">
        <IssuerSettingsSample standalone />
      </main>
    );
  }
  if (params.get("screen") === "filters") {
    return (
      <main className="mx-auto flex max-w-6xl flex-col gap-8 p-4 sm:p-8">
        <FilterSamples />
      </main>
    );
  }
  const content = params.get("content") === "1";
  return content ? <SamplesContent /> : <SamplesPreview />;
}

function SamplesPreview() {
  const [width, setWidth] = useState("auto");
  const frame = useRef<HTMLIFrameElement>(null);
  const contentUrl = new URL("./index.html?content=1", location.href).href;
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">디자인 샘플</h1>
          <p className="text-sm text-muted-foreground">화면 폭을 바꾸며 예시 데이터로 디자인과 동작을 확인합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" value={width} aria-label="미리보기 화면 폭"
            onValueChange={next => { if (next) setWidth(next); }}>
            {[["auto", "현재 화면"], ["390", "모바일"], ["1280", "데스크톱"]].map(([value, label]) =>
              <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
          <Button asChild variant="ghost"><a  href={contentUrl} target="_blank" rel="noreferrer">샘플만 열기 ↗</a></Button>
        </div>
      </header>
      <nav className="flex flex-wrap gap-1 px-4 py-2" aria-label="샘플 바로가기">
        {topics.map(([id, label]) => (
          <Button variant="ghost"
            key={id}
            type="button"
            onClick={() => frame.current?.contentDocument?.getElementById(id)?.scrollIntoView()}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4 [&_iframe]:mx-auto [&_iframe]:block [&_iframe]:h-full [&_iframe]:min-h-60 [&_iframe]:rounded-xl [&_iframe]:border [&_iframe]:bg-background">
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
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex min-w-0 flex-col gap-2">
        <p className="text-xs text-muted-foreground">WORKSPACE · DESIGN SAMPLES</p>
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">같은 역할, 같은 문법</h1>
        <p className="text-sm text-muted-foreground">
          공용 스타일과 컴포넌트를 로그인 없이 예시 데이터로 조작해 봅니다.
        </p>
      </header>
      <section id="settings" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-label="기본 설정 샘플">
        <AccountSettingsSample />
      </section>
      <section id="relations" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-label="자료 관계 샘플">
        <RelationSettingsSample />
      </section>
      <section id="issuers" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-label="번호 출처 샘플">
        <IssuerSettingsSample />
      </section>
      <section id="record-actions" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-label="기록 설정 샘플">
        <RecordActionsSample />
      </section>
      <section id="buttons" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-labelledby="buttons-title">
        <h2 id="buttons-title" className="text-2xl font-semibold tracking-tight wrap-anywhere">버튼</h2>
        <p className="text-sm text-muted-foreground">입력 옆 조작은 입력과 크기를 맞추고, 독립적인 보조 행동은 가볍게 표시합니다.</p>
        <ButtonSamples />
      </section>
      <section id="forms" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-labelledby="forms-title">
        <h2 id="forms-title" className="text-2xl font-semibold tracking-tight wrap-anywhere">폼과 상태</h2>
        <p className="text-sm text-muted-foreground">필수 입력, 도움말, 오류, 읽기 전용과 비활성을 비교해보세요.</p>
        <FormSamples />
      </section>
      <section id="filters" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-labelledby="filters-title">
        <h2 id="filters-title" className="text-2xl font-semibold tracking-tight wrap-anywhere">필터</h2>
        <p className="text-sm text-muted-foreground">조건을 편집한 뒤 아래 필터 적용으로 결과를 확인합니다.</p>
        <FilterSamples />
      </section>
      <section id="tags" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-labelledby="tags-title">
        <h2 id="tags-title" className="text-2xl font-semibold tracking-tight wrap-anywhere">태그</h2>
        <p className="text-sm text-muted-foreground">
          기본 기록 태그와 필터의 초안 선택을 비교합니다. 기존 자료의 독립 태그 연결은 아래 모달과 확인 예시에서 조작합니다.
        </p>
        <TagSamples />
      </section>
      <section id="workspace" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-labelledby="workspace-title">
        <h2 id="workspace-title" className="text-2xl font-semibold tracking-tight wrap-anywhere">목록과 자료 설정</h2>
        <p className="text-sm text-muted-foreground">
          입력 항목을 수정하고 변경 검토를 눌러보세요. 이력에는 당시 입력 항목과 변경 결과가 표시됩니다.
        </p>
        <MaterialWorkspaceSample />
      </section>
      <section id="dialogs" className="flex scroll-mt-4 flex-col gap-5 border-t pt-6" aria-labelledby="dialogs-title">
        <h2 id="dialogs-title" className="text-2xl font-semibold tracking-tight wrap-anywhere">모달과 확인</h2>
        <p className="text-sm text-muted-foreground">보기와 편집은 같은 전체 입력 항목을 유지합니다. 보기에서 태그만 연결하고, 편집에서는 같은 태그를 읽기 전용으로 확인합니다.</p>
        <ModalSamples />
      </section>
      <footer className="border-t pt-4 text-sm text-muted-foreground">
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
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Field label="자료 종류 선택">
          {(props) => (
            <NativeSelect
              {...props}
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {types.map((value) => <NativeSelectOption key={value}>{value}</NativeSelectOption>)}
            </NativeSelect>
          )}
        </Field>
        <Button variant="outline"
          type="button"
                    onClick={() => {
            const next = `새 종류 ${types.length - 1}`;
            setTypes([...types, next]);
            setType(next);
            setMessage("새 종류가 예시 목록에 추가됐습니다.");
          }}
        >
          종류 추가
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <MaterialSettingsSection title="입력 옆 조작과 섹션 푸터" summary="선택 항목" initialOpen>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
            {options.map((value, index) => (
              <div className="flex min-w-0 flex-wrap items-end gap-3" key={index}>
                <Field label={`선택 항목 ${index + 1}`}>
                  {(props) => (
                    <Input
                      {...props}
                      value={value}
                      onChange={(event) =>
                        setOptions(options.map((prior, i) => i === index ? event.target.value : prior))}
                    />
                  )}
                </Field>
                <Button variant="outline"
                  type="button"
                                    aria-label={`선택 항목 ${index + 1} 제거`}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                >
                  제거
                </Button>
              </div>
            ))}
            <div>
              <Button variant="ghost" type="button"  onClick={() => setOptions([...options, `새 선택 항목 ${options.length + 1}`])}><PlusIcon data-icon="inline-start" />
                항목 추가
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline"
                type="button"
                onClick={() => {
                  setOptions(["판매 중"]);
                  setMessage("예시 입력을 되돌렸습니다.");
                }}
              >
                변경 취소
              </Button>
              <Button variant="default" type="button"  onClick={() => setMessage("예시 입력을 저장했습니다.")}>
                저장
              </Button>
            </div>
          </div>
        </MaterialSettingsSection>
      </div>
      <div>
        <Button variant="ghost" type="button"
          onClick={() => {
            setTypes(["상품", "재료"]);
            setType("상품");
            setOptions(["판매 중"]);
            setMessage("예시를 처음 상태로 되돌렸습니다.");
          }}
        ><RotateCcwIcon data-icon="inline-start" />
          예시 초기화
        </Button>
        <Button variant="destructive" type="button"

          onClick={() => setMessage("위험 행동은 명확한 이름과 위험 색으로 표시합니다.")}
        ><UnlinkIcon data-icon="inline-start" />
          연결 해제 예시
        </Button>
        <Button variant="ghost" type="button" disabled ><PlusIcon data-icon="inline-start" />권한 없는 조작</Button>
      </div>
      <p className="text-sm text-muted-foreground m-0" role="status">
        {message || "종류 추가·항목 추가·제거·저장을 눌러 크기와 배치를 비교해보세요."}
      </p>
    </div>
  );
}

function FormSamples() {
  const [frequency, setFrequency] = useState("매일"), [zone, setZone] = useState("Asia/Seoul");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const invalid = !name.trim();
        setError(invalid ? "상품명을 입력하세요." : "");
        setSaved(!invalid);
        if (invalid) event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      }}
      noValidate
    ><FieldGroup>
      <Field label="상품명" required help="목록에서 알아볼 수 있는 이름을 입력하세요." error={error}>
        {(props) => (
          <Input
            {...props}
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
      <FieldSet className="border-0 p-0 flex min-w-0 flex-col gap-3 col-span-full">
        <FieldLegend className="text-sm font-medium">반복 주기</FieldLegend>
        <ToggleGroup type="single" variant="outline" aria-label="반복 주기" value={frequency} onValueChange={next => { if (next) setFrequency(next); }}>
          {["매일", "매주", "매월"].map(value => <ToggleGroupItem key={value} value={value}>{value}</ToggleGroupItem>)}
        </ToggleGroup>
      </FieldSet>
      <Field label="시간대">
        {(props) => <TimezoneSelect {...props} value={zone} onChange={(event) => setZone(event.target.value)} />}
      </Field>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
        <Field label="읽기 전용" help="내용을 읽고 복사할 수 있습니다.">
          {(props) => <Input {...props}  readOnly value="상품 · 버전 2" />}
        </Field>
        <Field label="비활성" help="현재 단계에서는 조작할 수 없습니다.">
          {(props) => <Input {...props}  disabled value="처리 중" />}
        </Field>
      </div>
      <DataFields>
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
      </DataFields>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="default"  type="submit">입력 확인</Button>
      </div>
      {saved && <Notice kind="success">입력 조건을 충족합니다.</Notice>}
    </FieldGroup></form>
  );
}
