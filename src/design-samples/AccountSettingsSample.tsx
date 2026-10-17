import { CardFooter } from "../components/ui/card.tsx";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "../components/ui/card.tsx";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx";
import { FieldGroup } from "../components/ui/field.tsx";
import { RotateCcwIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { TimezoneSelect } from "../components/TimezoneSelect.tsx";
import { useRef, useState } from "react";

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
    <Field pair label={label}>
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
            <ToggleGroup {...props} type="single" variant="outline" aria-label={label} value={draft[key]}
              onValueChange={next => { if (next) setDraft({ ...draft, [key]: next }); }}>
              {choices.map(value => <ToggleGroupItem key={value} value={value}>{value}{key === "mobile" || key === "desktop" ? "%" : ""}</ToggleGroupItem>)}
            </ToggleGroup>
          )
          : (
            <Input
              {...props}
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          )}
    </Field>
  );
  return (
    <section className="flex flex-col gap-6 min-w-0" aria-label="기본 설정 예시">
      <header className="flex min-w-0 flex-col gap-2">
        <Heading className="text-2xl font-semibold tracking-tight wrap-anywhere">기본 설정</Heading>
        <p className="text-sm text-muted-foreground">프로필과 날짜·시각, 화면 표시, 메뉴 바로가기를 내게 맞춥니다.</p>
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
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
              {field("mobile", "모바일 화면 배율", ["100", "110", "125", "150"])}
              {field("desktop", "데스크톱 화면 배율", ["100", "110", "125", "150"])}
            </div>
          ),
        },
      ] as const).map(({ id, title, keys, content }) => {
        const dirty = keys.some((key) => draft[key] !== saved[key]);
        return (
          <Card key={id} role="region" aria-label={title}>
            <CardHeader><CardTitle><SectionHeading>{title}</SectionHeading></CardTitle></CardHeader>
            <CardContent>
            <form
              className="flex min-w-0 flex-col gap-5"
              aria-label={`${title} 예시`}
              onSubmit={(event) => {
                event.preventDefault();
                setSaved({ ...saved, ...Object.fromEntries(keys.map((key) => [key, draft[key]])) });
                setMessage(`${title} 설정을 저장했습니다.`);
              }}
            ><FieldGroup>
              {content}
              <CardFooter className="-mx-4 mt-4 flex-wrap justify-end gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline"
                    type="button"
                    disabled={!dirty}
                    onClick={() => setDraft({ ...draft, ...Object.fromEntries(keys.map((key) => [key, saved[key]])) })}
                  >
                    취소
                  </Button>
                  <Button variant="default"  disabled={!dirty}>저장</Button>
                </div>
              </CardFooter>
            </FieldGroup></form></CardContent>
          </Card>
        );
      })}
      <Card role="region" aria-label="메뉴 바로가기">
        <CardHeader>
          <CardTitle><SectionHeading>메뉴 바로가기</SectionHeading></CardTitle><CardAction>
          <span className="text-sm text-muted-foreground" aria-label={`${menus.length}개 선택, 최대 4개`}>{menus.length}/4</span></CardAction>
        </CardHeader><CardContent>
        <form
          className="flex min-w-0 flex-col gap-5"
          aria-label="메뉴 바로가기 예시"
          onSubmit={(event) => {
            event.preventDefault();
            setSavedMenus(menus);
            setMessage("메뉴 설정을 저장했습니다.");
          }}
        ><FieldGroup>
          <ol className="flex min-w-0 flex-col gap-3" aria-label="선택한 바로가기">
            {menus.map((id, index) => {
              const entry = menuChoices.find((choice) => choice.id === id)!;
              return (
                <li className="flex min-w-0 flex-wrap items-center gap-3" key={id}>
                  <span className="flex min-w-0 flex-1 items-center gap-2 wrap-anywhere">
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
          {menus.length === 0 && <p className="text-sm text-muted-foreground">내 프로필만 표시합니다.</p>}
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <NativeSelect
              ref={addSelect}
              aria-label="추가할 메뉴"
              disabled={menus.length >= 4}
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <NativeSelectOption value="">{menus.length >= 4 ? "최대 4개 선택" : "메뉴 선택"}</NativeSelectOption>
              {menuChoices.filter((entry) => !menus.includes(entry.id)).map((entry) => (
                <NativeSelectOption key={entry.id} value={entry.id}>{entry.label}</NativeSelectOption>
              ))}
            </NativeSelect>
            <Button variant="outline"
              type="button"
              disabled={!candidate || menus.length >= 4}
              onClick={() => {
                setMenus([...menus, candidate]);
                setCandidate("");
              }}
            >
              추가
            </Button>
          </div>
          <CardFooter className="-mx-4 mt-4 flex-wrap justify-end gap-3">
            <Button variant="ghost" type="button"
              disabled={JSON.stringify(menus) === JSON.stringify(initialMenus)}
              onClick={() => setMenus(initialMenus)}
            ><RotateCcwIcon data-icon="inline-start" />
              기본 구성 사용
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline"
                type="button"
                disabled={!menuDirty}
                onClick={() => {
                  setMenus(savedMenus);
                  setCandidate("");
                }}
              >
                취소
              </Button>
              <Button variant="default"  disabled={!menuDirty}>저장</Button>
            </div>
          </CardFooter>
        </FieldGroup></form></CardContent>
      </Card>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
