import { BusinessCell, BusinessRow, BusinessTable } from "../components/BusinessTable.tsx";
import { CardFooter } from "../components/ui/card.tsx";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "../components/ui/card.tsx";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx";
import { FieldGroup } from "../components/ui/field.tsx";
import { RotateCcwIcon } from "lucide-react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "../components/ui/combobox.tsx";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { TimezoneSelect } from "../components/TimezoneSelect.tsx";
import { browserTimezone } from "../lib/timezone.ts";
import { useRef, useState } from "react";

import { Field } from "../components/Field.tsx";
import { EntityTypeIcon } from "../features/entity/EntityTypeIcon.tsx";
import { NavigationRowActions } from "../features/settings/NavigationRowActions.tsx";
import { preventShortcutSubmit, useShortcutImeGuard } from "../features/settings/shortcut-input.ts";

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
  const addSelect = useRef<HTMLInputElement>(null);
  const shortcutInput = useShortcutImeGuard();
  const section = useRef<HTMLElement>(null);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [savedMenus, setSavedMenus] = useState(initialMenus);
  const [menus, setMenus] = useState(initialMenus);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const menuDirty = JSON.stringify(menus) !== JSON.stringify(savedMenus);
  const field = (key: keyof typeof initial, label: string, choices?: string[]) => (
    <Field label={label}>
      {(props) =>
        key === "timezone"
          ? (
            <div className="flex min-w-0 flex-col items-start gap-2"><TimezoneSelect
              {...props}
              deviceDefault
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            />
            <Button variant="outline" type="button" className="h-auto min-h-11 max-w-full whitespace-normal wrap-anywhere py-2 text-left" disabled={!draft.timezone} onClick={event => {
              setDraft(value => ({...value, timezone: ""}));
              event.currentTarget.parentElement?.querySelector("select")?.focus();
            }}>기기 시간대 사용 ({browserTimezone()})</Button></div>
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
    <section ref={section} className="flex flex-col gap-6 min-w-0" aria-label="기본 설정 예시">
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
          <BusinessTable disclosureColumn={false} label="선택한 바로가기" columns={["메뉴", "순서와 표시"]}>
            {menus.map((id, index) => {
              const entry = menuChoices.find((choice) => choice.id === id)!;
              return (
                <BusinessRow key={id}>
                  <BusinessCell index={0}>
                  <span className="flex min-w-0 flex-1 items-center gap-2 wrap-anywhere">
                    <EntityTypeIcon id={entry.icon} />
                    {entry.label}
                  </span>
                  </BusinessCell>
                  <BusinessCell index={1}><NavigationRowActions
                    label={entry.label}
                    index={index}
                    count={menus.length}
                    onMove={(direction) => {
                      const next = [...menus];
                      [next[index], next[index + direction]] = [next[index + direction], next[index]];
                      setMenus(next);
                    }}
                    onRemove={(event) => {
                      const row = event.currentTarget.closest("tr");
                      const next = (row?.nextElementSibling ?? row?.previousElementSibling)
                        ?.querySelector<HTMLButtonElement>('button[title="바로가기에서 제거"]');
                      setMenus(menus.filter((value) => value !== id));
                      requestAnimationFrame(() => (next ?? addSelect.current)?.focus());
                    }}
                  /></BusinessCell>
                </BusinessRow>
              );
            })}
          </BusinessTable>
          {menus.length === 0 && <p className="text-sm text-muted-foreground">내 프로필만 표시합니다.</p>}
          <div className="flex min-w-0 flex-wrap items-end gap-3" onKeyDown={preventShortcutSubmit}>
            <Combobox<(typeof menuChoices)[number]>
              items={menuChoices.filter(entry => !menus.includes(entry.id))}
              value={null}
              inputValue={query}
              onInputValueChange={setQuery}
              isItemEqualToValue={(a,b) => a.id === b.id}
              itemToStringLabel={entry => entry.label}
              disabled={menus.length >= 4 || menus.length === menuChoices.length}
              onValueChange={entry => {
                if (!entry || menus.length >= 4 || menus.includes(entry.id)) return;
                setMenus([...menus, entry.id]);
                setQuery("");
                setMessage(`${entry.label} · 초안에 추가`);
                requestAnimationFrame(() => {
                  const destination = menus.length + 1 >= menuChoices.length
                    ? section.current?.querySelectorAll<HTMLButtonElement>('button[title="바로가기에서 제거"]').item(menus.length)
                    : addSelect.current;
                  destination?.focus();
                });
              }}
            >
              <ComboboxInput {...shortcutInput} ref={addSelect} aria-label="추가할 메뉴" placeholder={menus.length === menuChoices.length ? "추가할 메뉴 없음" : "메뉴를 골라 초안에 추가"} />
              <ComboboxContent><ComboboxEmpty>추가할 메뉴가 없습니다.</ComboboxEmpty><ComboboxList>{entry => <ComboboxItem key={entry.id} value={entry}>{entry.label} · 초안에 추가</ComboboxItem>}</ComboboxList></ComboboxContent>
            </Combobox>
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
                  setQuery("");
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
