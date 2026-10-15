import type { ReactNode } from "react";

export function PageHeading(
  { title, description, id, tabIndex, children }: {
    title: string;
    description: string;
    id?: string;
    tabIndex?: number;
    children?: ReactNode;
  },
) {
  return (
    <header className="page-heading">
      <div className="panel-head">
        <h1 className="page-title" id={id} tabIndex={tabIndex}>{title}</h1>
        {children}
      </div>
      <p className="page-description">{description}</p>
    </header>
  );
}
