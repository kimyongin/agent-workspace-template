import { profileIcons, profileIconId } from "./account-preferences.ts";

export function ProfileIcon({ id }: { id: unknown }) {
  const icon = profileIcons.find(icon => icon.id === profileIconId(id))!;
  return <span className="profile-icon" aria-hidden="true">{icon.emoji}</span>;
}
