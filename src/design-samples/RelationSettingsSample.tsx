import { FieldGroup, FieldSet } from "../components/ui/field.tsx";
import { PlusIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { TypedRelationsSample } from "./TypedRelationsSample.tsx";
import { useState } from "react";

import { Field } from "../components/Field.tsx";
import { IssuerRow } from "../features/settings/IssuerRow.tsx";
import type { EntityRelationDefinition } from "@contracts/entity-relation.ts";
const initial: EntityRelationDefinition["ends"] = [
  { type_id: "주문", label: "주문품목", cardinality: "many" },
  { type_id: "주문품목", label: "소속 주문", cardinality: "one" },
];
/** Uses the real continuous row, fields and responsive form styles; saves only this sample's local state. */
export function RelationSettingsSample({ standalone = false }: { standalone?: boolean }) {
  const Heading = standalone ? "h1" : "h2";
  const [saved, setSaved] = useState(initial), [ends, setEnds] = useState(initial);
  const [open, setOpen] = useState(false),
    [creating, setCreating] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label="자료 관계 설정 샘플">
      <header className="flex min-w-0 flex-col gap-2">
        <Heading className="text-2xl font-semibold tracking-tight wrap-anywhere">자료 관계 설정</Heading>
        <p className="text-sm text-muted-foreground">두 자료 종류 사이의 관계 이름과 연결 개수를 관리합니다.</p>
      </header>
      <Button variant="ghost" type="button"
        disabled={open}
        onClick={() => {
          setCreating(true);
          setOpen(true);
          setEnds([{ ...initial[0], label: "" }, { ...initial[1], label: "" }]);
        }}
      ><PlusIcon data-icon="inline-start" />
        관계 추가
      </Button>
      {message && <p role="status">{message}</p>}
      <div className="flex min-w-0 flex-col gap-4">
        <IssuerRow
          label={creating
            ? "새 관계"
            : saved.map((e) => `${e.type_id} · ${e.label} (${e.cardinality === "one" ? "하나만" : "여러 개"})`).join(
              " ↔ ",
            )}
          open={open}
          onToggle={() => {
            if (!open) {
              setCreating(false);
              setEnds(saved);
              setOpen(true);
            }
          }}
        >
          <form
            className="flex min-w-0 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setSaved(ends);
              setOpen(false);
              setCreating(false);
              setMessage("샘플에서 저장했습니다. 실제 설정은 변경하지 않았습니다.");
            }}
          ><FieldGroup>
            <p className="text-sm text-muted-foreground">각 자료에서 보이는 관계 이름과 연결할 상대 개수를 설정합니다.</p>
            <FieldSet className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
              {ends.map((end, index) => {
                const prefix = index === 0 ? "첫 번째" : "두 번째";
                const change = (patch: Partial<typeof end>) =>
                  setEnds((value) => value.map((e, n) => n === index ? { ...e, ...patch } : e) as typeof value);
                return (
                  <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere" key={index}>
                    <h3>{prefix} 방향</h3>
                    <Field pair label={`${prefix} 자료 종류`} required>
                      {(props) => (
                        <NativeSelect
                          {...props}
                          value={end.type_id}
                          onChange={(e) => change({ type_id: e.target.value })}
                        >
                          {["주문", "주문품목", "상품"].map((t) => <NativeSelectOption key={t}>{t}</NativeSelectOption>)}
                        </NativeSelect>
                      )}
                    </Field>
                    <Field pair label={`${prefix} 관계 이름`} required help="이 자료에서 상대를 부르는 이름">
                      {(props) => (
                        <Input
                          {...props}
                          required
                          value={end.label}
                          onChange={(e) => change({ label: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field pair label={`${prefix} 연결 개수`}>
                      {(props) => (
                        <NativeSelect
                          {...props}
                          value={end.cardinality}
                          onChange={(e) => change({ cardinality: e.target.value as "one" | "many" })}
                        >
                          <NativeSelectOption value="one">하나만 (0~1개)</NativeSelectOption>
                          <NativeSelectOption value="many">여러 개 (0개 이상)</NativeSelectOption>
                        </NativeSelect>
                      )}
                    </Field>
                  </div>
                );
              })}
            </FieldSet>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline"
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreating(false);
                }}
              >
                취소
              </Button>
              <Button variant="default"  type="submit">{creating ? "추가" : "저장"}</Button>
            </div>
          </FieldGroup></form>
        </IssuerRow>
      </div>
      <TypedRelationsSample />
    </section>
  );
}
