import { TimezoneSelect } from "../components/TimezoneSelect.tsx";
import { useRef, useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
import { Field } from "../components/Field.tsx";
import { EntityTypeIcon } from "../features/entity/EntityTypeIcon.tsx";
import { NavigationRowActions } from "../features/settings/NavigationRowActions.tsx";

const initial = { nickname: "김용인", timezone: "Asia/Seoul", mobile: "100", desktop: "100" };
const menuChoices = [
  { id: "products", label: "상품", icon: "box" },
  { id: "tasks", label: "할 일", icon: "tool" },
  { id: "records", label: "기록", icon: "book" },
];
const initialMenus = menuChoices.map((entry) => entry.id);

/** Real settings geometry and row controls; all writes stay in sample memory. */
export function AccountSettingsSample({ standalone = false }: { standalone?: boolean }) {
  const Heading = standalone ? "h1" : "h2";
  const SectionHeading = standalone ? "h2" : "h3";
  const addSelect = useRef<HTMLSelectElement>(null);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [savedMenus, setSavedMenus] = useState(initialMenus);
  const [menus, setMenus] = useState(initialMenus);
  const [candidate, setCandidate] = useState("");
  const [message, setMessage] = useState("");
  const menuDirty = JSON.stringify(menus) !== JSON.stringify(savedMenus);
  const field = (key: keyof typeof initial, label: string, choices?: string[]) => (
    <Field label={label}>
      {(props) =>
        key === "timezone"
          ? (
            <TimezoneSelect
              {...props}
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            />
          )
          : choices
          ? (
            <select
              {...props}
              className="input"
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            >
              {choices.map((value) => <option key={value} value={value}>{value}%</option>)}
            </select>
          )
          : (
            <input
              {...props}
              className="input"
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          )}
    </Field>
  );
  return (
    <section className="panel settings account-settings" aria-label="기본 설정 예시">
      <header className="page-heading">
        <Heading className="page-title">기본 설정</Heading>
        <p className="page-description">프로필과 날짜·시각, 화면 표시, 메뉴 바로가기를 내게 맞춥니다.</p>
      </header>
      {([
        { id: "profile", title: "프로필", keys: ["nickname"], content: field("nickname", "닉네임") },
        {
          id: "date",
          title: "날짜와 시각",
          keys: ["timezone"],
          content: field("timezone", "표시 시간대", ["Asia/Seoul", "UTC", "America/New_York"]),
        },
        {
          id: "display",
          title: "화면 표시",
          keys: ["mobile", "desktop"],
          content: (
            <div className="field-row">
              {field("mobile", "모바일 화면 배율", ["100", "110", "125", "150"])}
              {field("desktop", "데스크톱 화면 배율", ["100", "110", "125", "150"])}
            </div>
          ),
        },
      ] as const).map(({ id, title, keys, content }) => {
        const dirty = keys.some((key) => draft[key] !== saved[key]);
        return (
          <section key={id} className="settings-section" aria-label={title}>
            <SectionHeading className="settings-section-title">{title}</SectionHeading>
            <form
              className="form"
              aria-label={`${title} 예시`}
              onSubmit={(event) => {
                event.preventDefault();
                setSaved({ ...saved, ...Object.fromEntries(keys.map((key) => [key, draft[key]])) });
                setMessage(`${title} 설정을 저장했습니다.`);
              }}
            >
              {content}
              <div className="settings-section-footer">
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={!dirty}
                    onClick={() => setDraft({ ...draft, ...Object.fromEntries(keys.map((key) => [key, saved[key]])) })}
                  >
                    취소
                  </button>
                  <button className="btn btn-primary" disabled={!dirty}>저장</button>
                </div>
              </div>
            </form>
          </section>
        );
      })}
      <section className="settings-section navigation-settings" aria-label="메뉴 바로가기">
        <div className="navigation-settings-heading">
          <SectionHeading className="settings-section-title">메뉴 바로가기</SectionHeading>
          <span className="secondary" aria-label={`${menus.length}개 선택, 최대 4개`}>{menus.length}/4</span>
        </div>
        <form
          className="form"
          aria-label="메뉴 바로가기 예시"
          onSubmit={(event) => {
            event.preventDefault();
            setSavedMenus(menus);
            setMessage("메뉴 설정을 저장했습니다.");
          }}
        >
          <ol className="navigation-selection" aria-label="선택한 바로가기">
            {menus.map((id, index) => {
              const entry = menuChoices.find((choice) => choice.id === id)!;
              return (
                <li key={id}>
                  <span className="navigation-selection-label">
                    <EntityTypeIcon id={entry.icon} />
                    {entry.label}
                  </span>
                  <NavigationRowActions
                    label={entry.label}
                    index={index}
                    count={menus.length}
                    onMove={(direction) => {
                      const next = [...menus];
                      [next[index], next[index + direction]] = [next[index + direction], next[index]];
                      setMenus(next);
                    }}
                    onRemove={(event) => {
                      const row = event.currentTarget.closest("li");
                      const next = (row?.nextElementSibling ?? row?.previousElementSibling)
                        ?.querySelector<HTMLButtonElement>('button[title="바로가기에서 제거"]');
                      setMenus(menus.filter((value) => value !== id));
                      requestAnimationFrame(() => (next ?? addSelect.current)?.focus());
                    }}
                  />
                </li>
              );
            })}
          </ol>
          {menus.length === 0 && <p className="secondary">내 프로필만 표시합니다.</p>}
          <div className="navigation-add-row">
            <select
              ref={addSelect}
              className="input"
              aria-label="추가할 메뉴"
              disabled={menus.length >= 4}
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <option value="">{menus.length >= 4 ? "최대 4개 선택" : "메뉴 선택"}</option>
              {menuChoices.filter((entry) => !menus.includes(entry.id)).map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
            <button
              className="btn"
              type="button"
              disabled={!candidate || menus.length >= 4}
              onClick={() => {
                setMenus([...menus, candidate]);
                setCandidate("");
              }}
            >
              추가
            </button>
          </div>
          <div className="settings-section-footer navigation-settings-footer">
            <BodyAction
              icon="reset"
              disabled={JSON.stringify(menus) === JSON.stringify(initialMenus)}
              onClick={() => setMenus(initialMenus)}
            >
              기본 구성 사용
            </BodyAction>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={!menuDirty}
                onClick={() => {
                  setMenus(savedMenus);
                  setCandidate("");
                }}
              >
                취소
              </button>
              <button className="btn btn-primary" disabled={!menuDirty}>저장</button>
            </div>
          </div>
        </form>
      </section>
      {message && <p role="status" className="secondary">{message}</p>}
    </section>
  );
}
