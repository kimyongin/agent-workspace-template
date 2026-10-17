import { useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
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
    <section className="settings" aria-label="자료 관계 설정 샘플">
      <header className="page-heading">
        <Heading className="page-title">자료 관계 설정</Heading>
        <p className="page-description">두 자료 종류 사이의 관계 이름과 연결 개수를 관리합니다.</p>
      </header>
      <BodyAction
        icon="create"
        disabled={open}
        onClick={() => {
          setCreating(true);
          setOpen(true);
          setEnds([{ ...initial[0], label: "" }, { ...initial[1], label: "" }]);
        }}
      >
        관계 추가
      </BodyAction>
      {message && <p role="status">{message}</p>}
      <div className="issuer-registry-list">
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
            className="relation-definition-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSaved(ends);
              setOpen(false);
              setCreating(false);
              setMessage("샘플에서 저장했습니다. 실제 설정은 변경하지 않았습니다.");
            }}
          >
            <p className="secondary">각 자료에서 보이는 관계 이름과 연결할 상대 개수를 설정합니다.</p>
            <fieldset className="relation-definition-ends">
              {ends.map((end, index) => {
                const prefix = index === 0 ? "첫 번째" : "두 번째";
                const change = (patch: Partial<typeof end>) =>
                  setEnds((value) => value.map((e, n) => n === index ? { ...e, ...patch } : e) as typeof value);
                return (
                  <div className="relation-definition-end" key={index}>
                    <h3>{prefix} 방향</h3>
                    <Field label={`${prefix} 자료 종류`} required>
                      {(props) => (
                        <select
                          {...props}
                          className="input"
                          value={end.type_id}
                          onChange={(e) => change({ type_id: e.target.value })}
                        >
                          {["주문", "주문품목", "상품"].map((t) => <option key={t}>{t}</option>)}
                        </select>
                      )}
                    </Field>
                    <Field label={`${prefix} 관계 이름`} required help="이 자료에서 상대를 부르는 이름">
                      {(props) => (
                        <input
                          {...props}
                          className="input"
                          required
                          value={end.label}
                          onChange={(e) => change({ label: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={`${prefix} 연결 개수`}>
                      {(props) => (
                        <select
                          {...props}
                          className="input"
                          value={end.cardinality}
                          onChange={(e) => change({ cardinality: e.target.value as "one" | "many" })}
                        >
                          <option value="one">하나만 (0~1개)</option>
                          <option value="many">여러 개 (0개 이상)</option>
                        </select>
                      )}
                    </Field>
                  </div>
                );
              })}
            </fieldset>
            <div className="actions">
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreating(false);
                }}
              >
                취소
              </button>
              <button className="btn btn-primary" type="submit">{creating ? "추가" : "저장"}</button>
            </div>
          </form>
        </IssuerRow>
      </div>
    </section>
  );
}
