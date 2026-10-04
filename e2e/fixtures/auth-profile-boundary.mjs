// Real pinned SDK + actual provider source. Run via node --test; web tests include this regression.
// Only React hooks, network and storage scheduling are controlled.
import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { transformWithOxc } from "vite";
import { createClient, AuthClient } from "@supabase/supabase-js";

const first = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", email: "a@example.test", app_metadata: {}, user_metadata: { workspace_avatar_id: "person" } };
const second = { ...first, id: "00000000-0000-0000-0000-000000000002", email: "b@example.test" };
const updated = { ...first, user_metadata: { workspace_avatar_id: "leaf" } };
const fixtureExpiry = Math.floor(Date.now() / 1000) + 3600;
const jwt = id => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: fixtureExpiry, sub: id })}.fixture`;
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function eventually(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 2)); }
  assert.ok(check(), "asynchronous provider update must arrive");
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function loadSource(path, bindings, tail) {
  const source = fs.readFileSync(path, "utf8").replace(/^import[^\n]*\n/gm, "")
    .replace(/import\.meta\.env\.VITE_SUPABASE_URL/g, '"http://fixture.invalid"')
    .replace(/import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/g, '"fixture-public"');
  const { code } = await transformWithOxc(source, "boundary-source.tsx", { jsx: { runtime: "classic", pragma: "__jsx" }, tsconfig: false });
  return new Function(...Object.keys(bindings), code.replace(/\bexport /g, "") + tail)(...Object.values(bindings));
}

test("canonical display after local save, real profile broadcast, reload and relogin; SDK storage stays unchanged by profile", { timeout: 5000 }, async () => {
  const values = new Map(); let icon = "person", refreshes = 0;
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/token")) { refreshes++; throw new Error("unexpected profile refresh"); }
    if (String(input).includes("/logout")) return new Response(null, { status: 204 });
    if (init?.method === "PUT") { icon = "leaf"; return json({ ...first, user_metadata: { workspace_avatar_id: "star" } }); }
    return json({ ...first, user_metadata: { workspace_avatar_id: icon } });
  };
  const clients = [], renders = [], allHooks = [];
  const mount = async () => {
    const client = createClient("http://fixture.invalid", "fixture-public", { auth: { storage, storageKey: "canonical-session", autoRefreshToken: false, detectSessionInUrl: false } });
    clients.push(client);
    const hook = hooks(); allHooks.push(hook);
    const { profileIconId } = await loadSource("src/features/settings/profile.tsx", hook, "\nreturn {profileIconId};");
    const profile = await loadSource("src/features/auth/profile-client.ts", { AuthClient, profileIconId }, "\nreturn {profileClient, readProfile, ProfileDisplayRefreshError};");
    const provider = await loadSource("src/features/auth/AuthProvider.tsx", { ...hook, supabase: client, ...profile }, "\nreturn AuthProvider;");
    const render = () => hook.render(provider); renders.push(render); render();
    await eventually(() => render().session?.user.id === first.id);
    return { client, render, hook };
  };
  try {
    // The stored Auth session is deliberately stale after a decorative server write.
    values.set("canonical-session", JSON.stringify({ access_token: jwt(first.id), refresh_token: "refresh-a", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user: first }));
    const a = await mount(), b = await mount();
    await new Promise(r => setTimeout(r, 10));
    const before = values.get("canonical-session");
    assert.equal(await a.render().saveProfileIcon("star"), "leaf");
    await eventually(() => b.render().session?.user.user_metadata.workspace_avatar_id === "leaf");
    for (const render of renders) {
      assert.equal(render().session.user.user_metadata.workspace_avatar_id, "leaf");
      assert.equal(render().session.access_token, jwt(first.id));
    }
    assert.equal(values.get("canonical-session"), before);
    assert.equal((await a.client.auth.getSession()).data.session.user.user_metadata.workspace_avatar_id, "person");
    a.hook.cleanup();
    const reloaded = await mount();
    await eventually(() => reloaded.render().session?.user.user_metadata.workspace_avatar_id === "leaf");
    assert.equal(values.get("canonical-session"), before);
    await reloaded.client.auth.signOut();
    await reloaded.client.auth.setSession({ access_token: jwt(first.id), refresh_token: "relogin-refresh" });
    await eventually(() => reloaded.render().session?.user.user_metadata.workspace_avatar_id === "leaf");
    assert.equal(refreshes, 0);
  } finally {
    for (const hook of allHooks) hook.cleanup();
    for (const client of clients) await client.auth.dispose();
    globalThis.fetch = oldFetch;
  }
});
function hooks() {
  let cursor = 0; const slots = [], effects = [];
  return {
    createContext: value => ({ Provider: "provider", value }), useContext: c => c.value,
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect: (fn, deps) => { const i = cursor++; if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } },
    render: provider => { cursor = 0; const state = provider({ children: null }).props.value; for (const effect of effects.splice(0)) effect(); return state; },
    cleanup: () => { for (const slot of slots) slot?.cleanup?.(); },
    __jsx: (type, props) => ({ type, props }), Navigate: "navigate", useLocation: () => ({ pathname: "/settings", search: "" }),
  };
}

for (const order of ["older-save-fails", "newer-hydration-fails", "older-hydration"]) {
  test(`all canonical reads share ordering: ${order}`, { timeout: 5000 }, async () => {
    const values = new Map(), gate = deferred(), arrived = deferred(), newerArrived = deferred();
    let icon = "person", holdNext = false, held = false, refreshes = 0;
    const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/token")) { refreshes++; throw new Error("unexpected shared refresh"); }
      if (init?.method === "PUT") { icon = "star"; if (order !== "older-hydration") holdNext = true; return json({ ...first, user_metadata: { workspace_avatar_id: icon } }); }
      const captured = icon;
      if (holdNext && !held) {
        held = true; arrived.resolve(); await gate.promise;
        if (order === "older-save-fails") return json({ msg: "obsolete read failed" }, 400);
      } else if (held) {
        newerArrived.resolve();
        if (order === "newer-hydration-fails") return json({ msg: "latest read failed" }, 400);
      }
      return json({ ...first, user_metadata: { workspace_avatar_id: captured } });
    };
    const client = createClient("http://fixture.invalid", "fixture-public", { auth: { storage, storageKey: "canonical-order-" + order, autoRefreshToken: false, detectSessionInUrl: false } });
    const hook = hooks(), updates = new BroadcastChannel("workspace-decorative-profile");
    try {
      await client.auth.setSession({ access_token: jwt(first.id), refresh_token: "refresh-a" });
      const { profileIconId } = await loadSource("src/features/settings/profile.tsx", hook, "\nreturn {profileIconId};");
      const profile = await loadSource("src/features/auth/profile-client.ts", { AuthClient, profileIconId }, "\nreturn {profileClient, readProfile, ProfileDisplayRefreshError};");
      const provider = await loadSource("src/features/auth/AuthProvider.tsx", { ...hook, supabase: client, ...profile }, "\nreturn AuthProvider;");
      const render = () => hook.render(provider);
      render(); await new Promise(r => setTimeout(r, 10));
      const before = values.get("canonical-order-" + order);
      if (order === "older-hydration") {
        holdNext = true; updates.postMessage(first.id); await arrived.promise;
        assert.equal(await render().saveProfileIcon("star"), "star");
        gate.resolve(); await new Promise(r => setTimeout(r, 10));
        assert.equal(render().session.user.user_metadata.workspace_avatar_id, "star");
      } else {
        const outcome = render().saveProfileIcon("star").then(value => ({ value }), error => ({ error: error.message }));
        await arrived.promise;
        icon = "leaf"; updates.postMessage(first.id); await newerArrived.promise;
        if (order === "older-save-fails") await eventually(() => render().session.user.user_metadata.workspace_avatar_id === "leaf");
        gate.resolve();
        assert.deepEqual(await outcome, order === "older-save-fails" ? { value: "leaf" } : { error: new profile.ProfileDisplayRefreshError().message });
        assert.equal(render().session.user.user_metadata.workspace_avatar_id, order === "older-save-fails" ? "leaf" : "person");
      }
      assert.equal(values.get("canonical-order-" + order), before);
      assert.equal(refreshes, 0);
    } finally { gate.resolve(); updates.close(); hook.cleanup(); await client.auth.dispose(); globalThis.fetch = oldFetch; }
  });
}

// Keep both SDK boundaries: its guard protects a delayed /token response, but does not protect
// a shared-session read paused BEFORE snapshot capture. This is a negative SDK control, not app behavior.
for (const phase of ["before-snapshot", "after-snapshot"]) for (const action of ["logout", "switch"]) {
  test(`pinned SDK negative control ${phase} ${action}`, { timeout: 5000 }, async () => {
    const values = new Map(), gate = deferred(), arrived = deferred(); let arm = false;
    const storage = { getItem: async key => { const value = values.get(key) ?? null; if (arm) { arm = false; arrived.resolve(); await gate.promise; } return value; }, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
    const fetch = async (input, init) => {
      if (String(input).includes("/logout")) return json({ msg: "remote logout failure" }, 500);
      if (String(input).includes("/token")) { if (phase === "after-snapshot") { arrived.resolve(); await gate.promise; } return json({ access_token: jwt(first.id), refresh_token: "rotated-a", token_type: "bearer", expires_in: 3600, user: updated }); }
      return json(init?.headers?.Authorization === `Bearer ${jwt(second.id)}` ? second : first);
    };
    const client = createClient("http://fixture.invalid", "fixture-public", { global: { fetch }, auth: { storage, storageKey: "boundary-control", autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      await client.auth.setSession({ access_token: jwt(first.id), refresh_token: "refresh-a" });
      arm = phase === "before-snapshot";
      const refresh = client.auth.refreshSession(); await arrived.promise;
      if (action === "logout") await client.auth.signOut(); else await client.auth.setSession({ access_token: jwt(second.id), refresh_token: "refresh-b" });
      assert.equal(JSON.parse(values.get("boundary-control") ?? "null")?.user.id ?? null, action === "logout" ? null : second.id);
      gate.resolve(); await refresh;
      const expected = phase === "before-snapshot" ? first.id : action === "logout" ? null : second.id;
      assert.equal((await client.auth.getSession()).data.session?.user.id ?? null, expected);
      assert.equal(JSON.parse(values.get("boundary-control") ?? "null")?.user.id ?? null, expected);
    } finally { gate.resolve(); await client.auth.dispose(); }
  });
}

for (const phase of ["profile-response", "explicit-read-response", "private-read-initialization"]) for (const crossTab of [false, true]) for (const action of ["logout", "switch"]) {
  test(`actual provider ${phase} ${crossTab ? "cross-tab" : "same-tab"} ${action}: no shared session access or mutation`, { timeout: 5000 }, async () => {
    const values = new Map(), gate = deferred(), arrived = deferred(); let written = false, sharedReads = 0, refreshes = 0;
    const key = "provider-boundary";
    const storage = { getItem: k => { if (written) sharedReads++; return values.get(k) ?? null; }, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
    const oldFetch = globalThis.fetch;
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    if (crossTab) {
      // Minimal browser platform surface enables the SDK's REAL BroadcastChannel delivery.
      // No auth method, auth event, lock or session behavior is replaced.
      const events = new EventTarget();
      globalThis.window = { location: { href: "http://fixture.invalid/settings" }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
      globalThis.document = { visibilityState: "hidden" };
    }
    globalThis.fetch = async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (url.includes("/logout")) return json({ msg: "remote logout failure" }, 500);
      if (url.includes("/token")) { refreshes++; throw new Error("profile flow must never refresh"); }
      if (method === "PUT") { if (phase === "profile-response") { arrived.resolve(); await gate.promise; } written = true; return json(updated); }
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth === `Bearer ${jwt(second.id)}`) return json(second);
      if (written) { if (phase !== "profile-response") { arrived.resolve(); await gate.promise; } return json(updated); }
      return json(first);
    };
    const client = createClient("http://fixture.invalid", "fixture-public", { auth: { storage, storageKey: key, autoRefreshToken: false, detectSessionInUrl: false } });
    let actor = client;
    const hook = hooks(); let privateInitializations = 0;
    // Instrument storage scheduling only; every method/transition is the installed AuthClient.
    const InstrumentedAuthClient = new Proxy(AuthClient, { construct(Target, [options]) {
      const originalStorage = options.storage;
      if (phase === "private-read-initialization" && written) {
        options = { ...options, storage: { ...originalStorage, getItem: async k => { privateInitializations++; arrived.resolve(); await gate.promise; return originalStorage.getItem(k); } } };
      }
      return new Target(options);
    } });
    try {
      await client.auth.setSession({ access_token: jwt(first.id), refresh_token: "refresh-a" });
      if (crossTab) {
        actor = createClient("http://fixture.invalid", "fixture-public", { auth: { storage, storageKey: key, autoRefreshToken: false, detectSessionInUrl: false } });
        await actor.auth.getSession();
      }
      const { profileIconId } = await loadSource("src/features/settings/profile.tsx", hook, "\nreturn {profileIconId};");
      const profile = await loadSource("src/features/auth/profile-client.ts", { AuthClient: InstrumentedAuthClient, profileIconId }, "\nreturn {profileClient, readProfile, ProfileDisplayRefreshError};");
      const provider = await loadSource("src/features/auth/AuthProvider.tsx", { ...hook, supabase: client, ...profile }, "\nreturn AuthProvider;");
      const render = () => hook.render(provider);
      render(); await new Promise(r => setTimeout(r, 10));
      const outcome = render().saveProfileIcon("leaf").then(value => ({ value }), error => ({ error: error.message }));
      await arrived.promise;
      // No primary initialization/getSession/refresh path has been entered by the save.
      assert.equal(sharedReads, 0);
      if (phase === "private-read-initialization") assert.ok(privateInitializations > 0);
      if (action === "logout") await actor.auth.signOut(); else await actor.auth.setSession({ access_token: jwt(second.id), refresh_token: "refresh-b" });
      const expected = action === "logout" ? null : second.id;
      for (let i = 0; i < 100 && (render().session?.user.id ?? null) !== expected; i++) await new Promise(r => setTimeout(r, 1));
      const before = values.get(key) ?? null;
      assert.equal(render().session?.user.id ?? null, expected);
      gate.resolve(); assert.deepEqual(await outcome, { error: "로그인 계정이 변경되었습니다." });
      assert.equal(render().session?.user.id ?? null, expected);
      assert.equal(values.get(key) ?? null, before); // Entire SDK serialized session, including credentials.
      assert.equal((await client.auth.getSession()).data.session?.user.id ?? null, expected);
      assert.equal(refreshes, 0);
      assert.equal((await actor.auth.getSession()).data.session?.user.id ?? null, expected);
      console.log(JSON.stringify({ phase, crossTab, action, provider: expected, sdk: expected, stored: expected, serializedSessionUnchanged: true, profileSharedReads: 0, refreshes }));
    } finally {
      gate.resolve(); hook.cleanup(); await client.auth.dispose();
      if (actor !== client) await actor.auth.dispose();
      globalThis.fetch = oldFetch;
      if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
      if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    }
  });
}
