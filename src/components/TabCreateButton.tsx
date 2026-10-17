import { PlusIcon } from "lucide-react";
import { Button } from "./ui/button.tsx";
export function TabCreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button data-page-action="" type="button" aria-label={label} onClick={onClick}><PlusIcon data-icon="inline-start" />작성</Button>;
}
