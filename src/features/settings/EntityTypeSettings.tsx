import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useLocation, useParams } from "react-router";
import { api, isUncertain } from "../../lib/api.ts";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Field } from "../../components/Field.tsx";
import {
  type EntitySchemaVersion,
  type EntitySchemaVersionSummary,
  type EntityType,
  entityTypeIcons,
  resolvedEntityTypeIcon,
} from "@contracts/entity-type.ts";
import "./settings.css";
const glyphs = { box: "▣", leaf: "♧", package: "◇", book: "▤", tool: "⚒", star: "☆" };
export function EntityTypeIcon({ id }: { id: string }) {
  return <span aria-hidden="true">{glyphs[resolvedEntityTypeIcon(id)]}</span>;
}
export function EntityTypeSettings() {
  const { type_id } = useParams();
  const location = useLocation();
  const versions = location.pathname.endsWith("/versions");
  const [items, setItems] = useState<EntityType[]>([]),
    [type, setType] = useState<EntityType | null>(null),
    [schema, setSchema] = useState<EntitySchemaVersion | null>(null),
    [history, setHistory] = useState<EntitySchemaVersionSummary[]>([]);
  const [label, setLabel] = useState(""),
    [icon, setIcon] = useState("box"),
    [representative, setRepresentative] = useState("이름"),
    [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ key: string; method: string; path: string; input: unknown } | null>(null);
  const pending = useRef(false);
  const dirty = type_id
    ? !!type && (label !== type.label || icon !== type.icon_id || archived !== type.archived)
    : !!label.trim();
  const blocker = useBlocker(dirty || busy || uncertain);
  useEffect(() => {
    if (busy && blocker.state === "blocked") blocker.reset();
  }, [busy, blocker]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty || busy || uncertain) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy, uncertain]);
  const load = async (signal?: AbortSignal) => {
    if (type_id) {
      const [saved, definition, versions] = await Promise.all([
        api<EntityType>("GET", `/entity-types/${type_id}`, undefined, signal),
        api<EntitySchemaVersion>("GET", `/entity-types/${type_id}/schema`, undefined, signal),
        api<{ items: EntitySchemaVersionSummary[] }>("GET", `/entity-types/${type_id}/schemas`, undefined, signal),
      ]);
      setType(saved);
      setLabel(saved.label);
      setIcon(saved.icon_id);
      setArchived(saved.archived);
      setSchema(definition);
      setHistory(versions.items);
    } else {
      const saved = await api<{ items: EntityType[] }>("GET", "/entity-types?include_archived=true", undefined, signal);
      setItems(saved.items);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setType(null);
    setLabel("");
    attempt.current = null;
    setUncertain(false);
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "조회하지 못했습니다");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [type_id]);
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const current = attempt.current ?? {
      key: crypto.randomUUID(),
      method: type_id ? "PATCH" : "POST",
      path: type_id ? `/entity-types/${type_id}` : "/entity-types",
      input: type_id
        ? {
          expected_type_version: type!.version,
          expected_schema_version: type!.schema_version,
          label,
          icon_id: icon,
          archived,
        }
        : { label, icon_id: icon, representative_label: representative },
    };
    attempt.current = current;
    try {
      const saved = await api<EntityType>(current.method, current.path, current.input, undefined, current.key);
      attempt.current = null;
      setUncertain(false);
      if (type_id) {
        setType(saved);
        setLabel(saved.label);
        setIcon(saved.icon_id);
        setArchived(saved.archived);
      } else {
        setItems((rows) => [...rows, saved]);
        setLabel("");
        setRepresentative("이름");
      }
      setMessage("자료 종류를 저장했습니다.");
    } catch (e) {
      const unknown = isUncertain(e);
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
      setError(e instanceof Error ? e.message : "저장하지 못했습니다. 입력은 유지했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="panel settings" aria-labelledby="entity-types-title">
      <Link to="/settings">설정</Link>
      <h1 id="entity-types-title" className="page-title">{type_id ? type?.label ?? "자료 종류" : "자료 종류·속성"}</h1>
      {type_id && (
        <nav aria-label="자료 종류 설정">
          <Link to={`/settings/entity-types/${type_id}`}>속성·표시</Link>
          {" · "}
          <Link to={`/settings/entity-types/${type_id}/versions`}>버전</Link>
          {" · "}
          <Link to="/settings/entity-types">자료 종류 목록</Link>
        </nav>
      )}
      {loading && <p role="status">불러오는 중…</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!loading && !type_id && (
        <>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <Link to={`/settings/entity-types/${item.id}`}>
                  <EntityTypeIcon id={item.icon_id} /> {item.label}
                  {item.archived ? " (보관)" : ""}
                </Link>
              </li>
            ))}
          </ul>
          {items.length === 0 && (
            <p className="secondary">자료 종류가 없습니다. 이름을 정해 첫 자료 종류를 만드세요.</p>
          )}
        </>
      )}
      {!loading && (!type_id || type) && !versions && (
        <section className="settings-section">
          <h2 className="settings-section-title">{type_id ? "자료 종류 설정" : "자료 종류 만들기"}</h2>
          <form
            className="form"
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset className="settings-fields" disabled={busy || uncertain}>
              <Field label="자료 종류 이름">
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    required
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                )}
              </Field>
              <Field label="아이콘">
                {(props) => (
                  <select
                    {...props}
                    className="input"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                  >
                    {entityTypeIcons.map((item) => (
                      <option key={item.id} value={item.id}>{glyphs[item.id]} {item.label}</option>
                    ))}
                  </select>
                )}
              </Field>
              {!type_id && (
                <Field label="대표 속성 이름">
                  {(props) => (
                    <input
                      {...props}
                      className="input"
                      required
                      maxLength={80}
                      value={representative}
                      onChange={(e) => setRepresentative(e.target.value)}
                    />
                  )}
                </Field>
              )}
              {type_id && (
                <label>
                  <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{" "}
                  자료 종류 보관 (기존 자료와 연결은 유지)
                </label>
              )}
            </fieldset>
            <div className="settings-section-footer">
              <p className="secondary">
                {uncertain
                  ? "저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요."
                  : type_id
                  ? "이름·아이콘·보관 상태 변경은 속성 정의와 저장값을 바꾸지 않습니다."
                  : "필수 텍스트 대표 속성과 함께 생성합니다."}
              </p>
              <button className="btn btn-primary" disabled={busy || (!dirty && !uncertain)}>
                {busy ? "저장 중…" : uncertain ? "같은 요청 다시 확인" : type_id ? "저장" : "자료 종류 만들기"}
              </button>
            </div>
          </form>
        </section>
      )}
      {schema && !versions && (
        <section className="settings-section">
          <h2 className="settings-section-title">속성·표시 · 버전 {schema.schema_version}</h2>
          <ul>
            {schema.display.order.map((key) => (
              <li key={key}>
                {schema.schema.properties[key].title ?? key} · {key} ·{" "}
                {schema.schema.properties[key].format === "date" ? "날짜" : String(schema.schema.properties[key].type)}
                {schema.schema.required.includes(key) ? " · 필수" : ""}
                {key === schema.display.representative ? " · 대표" : ""}
                {schema.display.archived.includes(key) ? " · 보관" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {versions && schema && (
        <p>
          선택한 버전 {schema.schema_version}:{" "}
          {schema.display.order.map((key) => schema.schema.properties[key].title ?? key).join(" · ")}
        </p>
      )}
      {versions && (
        <section className="settings-section">
          <h2 className="settings-section-title">게시 버전</h2>
          {history.map((value) => (
            <details key={value.schema_version}>
              <summary>버전 {value.schema_version} · {new Date(value.created_at).toLocaleString()}</summary>
              <button
                className="btn"
                onClick={() =>
                  void api<EntitySchemaVersion>(
                    "GET",
                    `/entity-types/${type_id}/schema?schema_version=${value.schema_version}`,
                  ).then(setSchema).catch((e) => setError(e.message))}
              >
                이 버전 보기
              </button>
            </details>
          ))}
        </section>
      )}
      <ConfirmDialog
        open={!busy && blocker.state === "blocked"}
        title="변경을 버릴까요?"
        message={uncertain
          ? "저장 결과를 확인하지 못한 요청이 있습니다. 현재 상태를 확인한 뒤 작업을 이어가세요."
          : "저장하지 않은 설정이 사라집니다."}
        confirmLabel="이동"
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
      />
    </section>
  );
}
