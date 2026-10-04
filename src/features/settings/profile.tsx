export const profileIcons = [
  { id: "person", label: "기본", path: "M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0" },
  { id: "leaf", label: "잎", path: "M20 3C7 3 3 7 3 13a7 7 0 0 0 14 0c0-3 1-6 3-10ZM5 20 15 10" },
  { id: "sun", label: "해", path: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" },
  { id: "star", label: "별", path: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" },
] as const;
export type ProfileIconId = typeof profileIcons[number]["id"];
export function profileIconId(value: unknown): ProfileIconId {
  return profileIcons.find(icon => icon.id === value)?.id ?? "person";
}
export function ProfileIcon({ id }: { id: unknown }) {
  const icon = profileIcons.find(icon => icon.id === profileIconId(id))!;
  return <svg className="profile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon.path} /></svg>;
}
