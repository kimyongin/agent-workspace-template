import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./body-action.css";

type ActionIcon = "create" | "link" | "unlink" | "close" | "view" | "filter" | "reset";
const paths: Record<ActionIcon, ReactNode> = {
  filter: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  reset: <path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>,
  create: <path d="M12 5v14M5 12h14"/>,
  link: <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>,
  unlink: <path d="m18.84 12.25 1.23-1.23a5 5 0 0 0-7.07-7.07l-1.23 1.23M5.16 11.75l-1.23 1.23a5 5 0 0 0 7.07 7.07l1.23-1.23M8 2v3M2 8h3M16 19v3M19 16h3"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  view: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
};

/** The small visible face is shared by buttons and navigation links. */
export function BodyActionFace({icon,children}: {icon?:ActionIcon;children:ReactNode}) {
  return <span className="body-action-face" data-tone={icon==="create"||icon==="link"?"accent":undefined}>
    {icon&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[icon]}</svg>}{children}
  </span>;
}

export function BodyAction({icon,children,className,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon?:ActionIcon}) {
  return <button type="button" {...props} className={["body-action",className].filter(Boolean).join(" ")}><BodyActionFace icon={icon}>{children}</BodyActionFace></button>;
}
