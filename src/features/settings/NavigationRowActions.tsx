import { ArrowUpIcon, ArrowDownIcon, XIcon } from "lucide-react";

import { Button } from "../../components/ui/button.tsx";
import type { MouseEvent } from "react";

/** Same visible icons and hit areas in the actual settings and the public sample. */
export function NavigationRowActions({ label, index, count, disabled = false, onMove, onRemove }: {
  label: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {([
        { name: "위로 이동", icon: ArrowUpIcon, unavailable: index === 0, move: -1 },
        { name: "아래로 이동", icon: ArrowDownIcon, unavailable: index === count - 1, move: 1 },
        { name: "숨기기", icon: XIcon, unavailable: false, move: null },
      ] as const).map((action) => (
        <Button variant="ghost" size="icon"
          key={action.name}
          type="button"

          aria-label={`${label} ${action.name}`}
          title={action.move === null ? "바로가기에서 제거" : action.name}
          disabled={disabled || action.unavailable}
          onClick={(event) => action.move === null ? onRemove(event) : onMove(action.move)}
        >
          <action.icon />
        </Button>
      ))}
    </div>
  );
}
