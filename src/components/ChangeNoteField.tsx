import { Field } from "./Field.tsx";
export function ChangeNoteField({value, onChange, required = false, error, label}: {value: string; onChange: (value: string) => void; required?: boolean; error?: string;label?:string}) {
  return <Field label={label??(required ? "편집 메모" : "이유 (선택)")} required={required} error={error}>
    {p => <textarea {...p} className="input" rows={3} placeholder="변경 이유나 보충할 내용" value={value} onChange={e => onChange(e.target.value)} />}
  </Field>;
}

