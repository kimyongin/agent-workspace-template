import { useNavigationPreview } from "../features/settings/navigation-preview.tsx";
import { type Ref, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../features/auth/AuthProvider.tsx";
import { ProfileIcon } from "../features/settings/profile.tsx";
import { accountPreferences, profileName } from "../features/settings/account-preferences.ts";

import { navigationSection } from "./navigation-section.ts";
import appIcon from "./app-icon.svg";
import { api } from "../lib/api.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import {
  currentNavigationName,
  defaultNavigationRefs,
  entityTypeLocation,
  navigationCapacity,
  navigationEntryCurrent,
  resolveNavigationRefs,
  visibleNavigationEntries,
} from "./type-navigation.ts";
import { useEntityTypes } from "../features/entity/useEntityTypes.ts";
import { EntityTypeIcon } from "../features/entity/EntityTypeIcon.tsx";
const popoverIcons = {
  "/status": <path d="M3 18V6M3 18h18M7 14l4-5 4 3 5-7" />,
  "/guide": <path d="M4 4h6l2 2 2-2h6v16h-6l-2 2-2-2H4ZM12 6v16" />,
  "/settings": (
    <>
      <path d="M19.39 8.94L19.83 10.34L21.88 10.44L21.88 13.56L19.83 13.66L19.39 15.06L18.71 16.36L20.09 17.88L17.88 20.09L16.36 18.71L15.06 19.39L13.66 19.83L13.56 21.88L10.44 21.88L10.34 19.83L8.94 19.39L7.64 18.71L6.12 20.09L3.91 17.88L5.29 16.36L4.61 15.06L4.17 13.66L2.12 13.56L2.12 10.44L4.17 10.34L4.61 8.94L5.29 7.64L3.91 6.12L6.12 3.91L7.64 5.29L8.94 4.61L10.34 4.17L10.44 2.12L13.56 2.12L13.66 4.17L15.06 4.61L16.36 5.29L17.88 3.91L20.09 6.12L18.71 7.64Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "/logout": (
    <>
      <path d="M9 4H4v16h5M10 12h10m-4-4 4 4-4 4" />
    </>
  ),
};
function PopoverLink({ to, label }: { to: keyof typeof popoverIcons; label: string }) {
  return (
    <Link to={to} className={to === "/logout" ? "nav-logout" : undefined}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {popoverIcons[to]}
      </svg>
      <span>{label}</span>
    </Link>
  );
}
export function Navigation({ brand, navigationRef }: { brand: string; navigationRef?: Ref<HTMLElement> }) {
  const location = useLocation();
  const { session } = useAuth();
  const catalog = useEntityTypes(location.key);
  const { preview } = useNavigationPreview();
  const preference = preview === undefined ? accountPreferences(session?.user.user_metadata ?? {}).navigation : preview;
  const entries = visibleNavigationEntries(resolveNavigationRefs(
    preference?.refs ?? defaultNavigationRefs(catalog.types ?? []),
    catalog.types ?? [],
  ));
  const [keyword, setKeyword] = useState("");
  const requestedTypeId = entityTypeLocation(location.search);
  const [detailType, setDetailType] = useState<{ path: string; id: string } | null>(null);
  const typeId = requestedTypeId ?? (detailType?.path === location.pathname ? detailType.id : null);
  useEffect(() => {
    const controller = new AbortController();
    if (!requestedTypeId && /^\/entities\/[^/]+$/.test(location.pathname)) {
      void api<EntityDetail>("GET", location.pathname, undefined, controller.signal).then((entity) => {
        if (!controller.signal.aborted) setDetailType({ path: location.pathname, id: entity.entity_type_id });
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [location.pathname, requestedTypeId, session?.user.id]);
  const owner = location.pathname.startsWith("/settings") ? null : location.state?.workspaceOwner;
  const current = navigationSection(
    typeof owner === "string" && /^\/(entities|tasks|records|principles|search)$/.test(owner)
      ? owner
      : location.pathname,
  );
  const isCurrent = (entry: (typeof entries)[number]) => navigationEntryCurrent(entry, current, typeId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(4);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () =>
      setCapacity(
        navigationCapacity(
          element.clientWidth,
          parseFloat(getComputedStyle(element).fontSize),
          window.innerWidth >= 1024 && window.innerHeight >= 320,
        ),
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = (restore = false) => {
    setOpen(false);
    if (restore) profileTrigger.current?.focus();
  };
  useEffect(() => {
    setOpen(false);
  }, [location, session?.user.id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
      if (!root.current?.contains(event.target as Node)) close(true);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  // Bound the menu by its actual anchor position, including short or enlarged layouts.
  useLayoutEffect(() => {
    const menu = popover.current;
    if (!open || !menu) return;
    const measure = () => {
      menu.style.setProperty(
        "--profile-menu-remaining-height",
        `${Math.max(0, window.innerHeight - menu.getBoundingClientRect().top)}px`,
      );
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && menu.contains(focused)) {
        focused.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (profileTrigger.current) observer.observe(profileTrigger.current);
    if (menu.firstElementChild) observer.observe(menu.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  const profileCurrent = current === "more" || !!current && !entries.slice(0, capacity).some(isCurrent);
  const settingsTypeId = location.pathname.match(/^\/settings\/(?:entity-types|materials)\/([^/]+)/)?.[1];
  const currentLabel = currentNavigationName(
    current,
    location.pathname,
    catalog.types?.find((type) => type.id === (settingsTypeId ?? typeId))?.label,
  );
  return (
    <nav className="bottom-nav" aria-label="주 메뉴" id="workspace-navigation" ref={navigationRef}>
      <div className="navigation-brand">
        <img src={appIcon} alt="" />
        <span>{brand}</span>
      </div>
      <div
        className="bottom-nav-inner"
        style={{
          gridTemplateColumns: `44px repeat(${Math.max(1, Math.min(capacity, entries.length))}, minmax(44px, 1fr))`,
        }}
        ref={root}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Element && event.relatedTarget.closest("dialog[open]")) return;
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            close(true);
          }
          if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const items = Array.from(popover.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? []);
            if (!items.length) return;
            event.preventDefault();
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === "Home"
              ? 0
              : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
              ? (index + 1) % items.length
              : (index - 1 + items.length) % items.length;
            items[next].focus();
          }
        }}
      >
        <div className="nav-profile">
          <button
            className="nav-profile-trigger"
            type="button"
            ref={profileTrigger}
            aria-label={profileCurrent ? `내 프로필 · ${currentLabel} 현재 화면` : "내 프로필"}
            aria-current={profileCurrent ? "page" : undefined}
            aria-expanded={open}
            aria-controls="nav-profile-options"
            data-current={profileCurrent || undefined}
            onClick={() => setOpen((value) => !value)}
          >
            <ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} />
            <span className="nav-control-label">내 계정</span>
          </button>
          {open && (
            <div className="nav-profile-options" id="nav-profile-options" ref={popover}>
              <div className="nav-profile-identity">
                <ProfileIcon id={session?.user.user_metadata?.workspace_avatar_id} />
                <p>{profileName(session?.user.user_metadata)}</p>
              </div>
              <div className="nav-profile-business" aria-label="업무 메뉴">
                {resolveNavigationRefs(
                  ["entities", "tasks", "records", "principles"].map((id) => ({
                    kind: "builtin" as const,
                    id: id as "entities" | "tasks" | "records" | "principles",
                  })),
                  catalog.types ?? [],
                ).map((entry) => (
                  <Link key={entry.key} to={entry.to} aria-current={isCurrent(entry) ? "page" : undefined}>
                    <EntityTypeIcon id={entry.icon} />
                    <span>{entry.label}</span>
                  </Link>
                ))}
                {(catalog.types?.length ?? 0) > 6 && (
                  <label className="field">
                    <span className="label">자료 종류 검색</span>
                    <input
                      type="search"
                      className="input"
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                    />
                  </label>
                )}
                {catalog.types?.filter((type) => type.label.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
                  .map((type) => (
                    <Link
                      key={type.id}
                      to={`/entities?entity_type_id=${type.id}`}
                      aria-current={current === "entities" && typeId === type.id ? "page" : undefined}
                    >
                      <EntityTypeIcon id={type.icon_id} />
                      <span>{type.label}{type.archived ? " · 보관" : ""}</span>
                    </Link>
                  ))}
                {catalog.error && (
                  <>
                    <p role="alert" className="error-text">자료 종류를 불러오지 못했습니다.</p>
                    <button className="btn" onClick={catalog.retry}>다시 시도</button>
                  </>
                )}
              </div>
              <PopoverLink to="/status" label="상태" />
              <PopoverLink to="/settings" label="설정" />
              <PopoverLink to="/guide" label="사용 가이드" />
              <PopoverLink to="/logout" label="로그아웃" />
            </div>
          )}
        </div>
        {entries.slice(0, capacity).map((entry) => (
          <Link
            key={entry.key}
            to={entry.to}
            title={entry.label}
            aria-label={entry.label}
            aria-current={isCurrent(entry) ? "page" : undefined}
          >
            <span className="navigation-icon">
              <EntityTypeIcon id={entry.icon} />
            </span>
            <span>{entry.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
