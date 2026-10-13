import { resolvedEntityTypeIcon } from "@contracts/entity-type.ts";
import "./entity-type-icon.css";
const paths = {
  box: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v11h14V9m-9 4h4" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4c0 7-1 15-9 15a7 7 0 0 1-7-7C4 5 12 5 20 4Z" />
      <path d="m4 20 10-10" />
    </>
  ),
  package: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9m-4.5-16.5 9 5" />,
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z" />
      <path d="M8 7h8m-8 4h5" />
    </>
  ),
  tool: <path d="m14.5 6.5 3 3 3-3a6 6 0 0 1-7.8 7.8L6 21a2.1 2.1 0 0 1-3-3l6.7-6.7a6 6 0 0 1 7.8-7.8Z" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
};
export function EntityTypeIcon({ id }: { id: string }) {
  const icon = resolvedEntityTypeIcon(id);
  return (
    <svg
      className="entity-type-icon"
      data-icon={icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[icon]}
    </svg>
  );
}
