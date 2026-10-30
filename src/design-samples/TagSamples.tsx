import { FieldSet } from "../components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { useState } from "react";
import { Field, Notice } from "../components/Field.tsx";
import { TagSelection } from "../features/tags/TagSelection.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { ConfirmationSurface, ConfirmDialog } from "../components/ConfirmDialog.tsx";

const tags = [
  "중요",
  "진행 중",
  "참고",
  ...Array.from({ length: 8 }, (_, i) => i === 7 ? "공백없이길게이어진태그이름".repeat(4) : `태그 ${i + 4}`),
]
  .map((name, index) => ({ id: `tag-${index}`, name }));

export function TagSamples() {
  const [mode, setMode] = useState("normal");
  const [selected, setSelected] = useState<string[]>([]);
  const [addedTags, setAddedTags] = useState<{ id: string; name: string }[]>([]);
  const [managing, setManaging] = useState(false);
  return (
    <div className="grid min-w-0 gap-4">
      <Field label="태그 예시 상태">
        {(props) => (
          <NativeSelect
            {...props}
            value={mode}
            onChange={(event) => {
              const next = event.target.value;
              setMode(next);
              setSelected(
                next === "excluded"
                  ? [tags[0].id]
                  : next === "unknown"
                  ? [tags[0].id]
                  : ["loading", "failure", "busy"].includes(next)
                  ? [tags[0].id]
                  : [],
              );
            }}
          >
            <NativeSelectOption value="normal">일반 선택</NativeSelectOption>
            <NativeSelectOption value="single">단일 태그 필터</NativeSelectOption>
            <NativeSelectOption value="excluded">제외한 기존 선택</NativeSelectOption>
            <NativeSelectOption value="many">선택 한도</NativeSelectOption>
            <NativeSelectOption value="empty">태그 없음</NativeSelectOption>
            <NativeSelectOption value="loading">불러오는 중</NativeSelectOption>
            <NativeSelectOption value="failure">조회 실패</NativeSelectOption>
            <NativeSelectOption value="unknown">이름 확인 필요</NativeSelectOption>
            <NativeSelectOption value="busy">저장 중</NativeSelectOption>
          </NativeSelect>
        )}
      </Field>
      <FieldSet disabled={mode === "busy"} className="min-w-0 border-0 p-0">
        <TagSelection
          action={<Button type="button" variant="ghost" disabled={mode === "busy"} className="h-auto min-h-11 whitespace-normal" onClick={() => setManaging(true)}>기록 태그 관리</Button>}
          disabled={mode === "busy"}
          label="기본 기록 태그"
          tags={mode === "loading" || mode === "failure"
            ? null
            : mode === "empty" || mode === "unknown"
            ? addedTags
            : mode === "many"
            ? tags
            : [...tags.slice(0, 3), ...addedTags]}
          maxSelected={mode === "single" ? 1 : 10}
          excludeId={mode === "excluded" ? tags[0].id : undefined}
          value={selected}
          onChange={setSelected}
          status={mode === "loading"
            ? <p className="text-sm text-muted-foreground" role="status">태그를 불러오는 중…</p>
            : mode === "failure"
            ? <Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice>
            : undefined}
        />
      </FieldSet>
      {managing && <TagManagementSample onClose={() => setManaging(false)} onAdd={name => setAddedTags(current => [...current, { id: `sample-added-${current.length}`, name }])} />}
    </div>
  );
}

function TagManagementSample({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const close = () => { if (name) setDiscarding(true); else onClose(); };
  return <>
    <ConfirmationSurface open title="기록 태그 관리" closeButton onCancel={close}
      footer={<Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={close}>기록 자동 완성으로 돌아가기</Button>}>
      <p className="mb-4 text-sm text-muted-foreground">같은 화면에서 태그를 추가하는 예시입니다. 추가한 뒤 돌아가서 태그를 직접 선택하세요. 실제 데이터는 저장하지 않습니다.</p>
      <form className="grid min-w-0 gap-3" onSubmit={event => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onAdd(trimmed); setSaved(current => [...current, trimmed]); setName("");
      }}>
        <Field label="태그 이름" required>{props => <Input {...props} value={name} maxLength={30} onChange={event => setName(event.target.value)} />}</Field>
        <Button type="submit" className="justify-self-start">추가</Button>
      </form>
      {saved.length > 0 && <p role="status" className="mt-4 text-sm wrap-anywhere">추가한 예시 태그: {saved.join(", ")}</p>}
    </ConfirmationSurface>
    <ConfirmDialog open={discarding} title="변경을 버릴까요?" message="입력 중인 태그 이름을 버립니다. 이미 추가한 예시 태그는 유지합니다." confirmLabel="변경 버리기" onCancel={() => setDiscarding(false)} onConfirm={onClose} />
  </>;
}
