import { profileIcons, profileIconId } from "./account-preferences.ts";

export function ProfileIcon({ id }: { id: unknown }) {
  const icon = profileIcons.find(icon => icon.id === profileIconId(id))!;
  return <span className="inline-flex size-6 shrink-0 items-center justify-center" aria-hidden="true">{icon.emoji}</span>;
}
