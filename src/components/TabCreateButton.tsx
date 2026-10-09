import { BodyAction } from "./BodyAction.tsx";
export function TabCreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <BodyAction icon="create" className="tab-create-button" aria-label={label} onClick={onClick}>작성</BodyAction>;
}
