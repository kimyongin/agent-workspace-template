export function TabCreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="btn btn-primary tab-create-button" aria-label={label} onClick={onClick}><span aria-hidden="true">＋</span> 작성</button>;
}
