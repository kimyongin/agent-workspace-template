import { SettingsMenu } from "./SettingsMenu.tsx";

export function SettingsHeading({ title, id, tabIndex }: { title: string; id?: string; tabIndex?: number }) {
  return (
    <div className="panel-head settings-heading">
      <h1 className="page-title" id={id} tabIndex={tabIndex}>{title}</h1>
      <SettingsMenu />
    </div>
  );
}
