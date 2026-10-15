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
    <div className="navigation-row-actions">
      {([
        { name: "위로 이동", path: "m6 12 6-6 6 6M12 6v14", unavailable: index === 0, move: -1 },
        { name: "아래로 이동", path: "m6 12 6 6 6-6M12 4v14", unavailable: index === count - 1, move: 1 },
        { name: "숨기기", path: "m6 6 12 12M6 18 18 6", unavailable: false, move: null },
      ] as const).map((action) => (
        <button
          key={action.name}
          type="button"
          className="navigation-icon-action"
          aria-label={`${label} ${action.name}`}
          title={action.move === null ? "바로가기에서 제거" : action.name}
          disabled={disabled || action.unavailable}
          onClick={(event) => action.move === null ? onRemove(event) : onMove(action.move)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={action.path} />
          </svg>
        </button>
      ))}
    </div>
  );
}
