import { Link, useLocation } from "react-router";
export const settingsCategories = [
  { to: "/settings", label: "기본" },
  { to: "/settings/materials", label: "자료" },
  { to: "/settings/tags", label: "태그" },
  { to: "/settings/records", label: "기록" },
  { to: "/settings/issuers", label: "발급처" },
] as const;
export function SettingsNavigation() {
  const { pathname } = useLocation();
  return <nav className="settings-links" aria-label="설정 범주">{settingsCategories.map(({ to, label }) => <Link key={to} to={to} aria-current={pathname === to || to !== "/settings" && pathname.startsWith(`${to}/`) || to === "/settings/materials" && pathname.startsWith("/settings/entity-types") ? "page" : undefined}>{label}</Link>)}</nav>;
}
