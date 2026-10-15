// Actual App/StrictMode/Supabase SDK; only Auth HTTP replies are fixtures. No DB or credentials.
import { expect, type Page, test } from "@playwright/test";

const userA = "00000000-0000-4000-8000-000000000001", userB = "00000000-0000-4000-8000-000000000002";
type RequestKey = { id: string; userId: string };
const details = (name: string) => ({
  client: { name }, redirect_uri: "http://127.0.0.1:55390/callback", scope: "email",
});

async function authFixture(page: Page, reply: (key: RequestKey) => Promise<object>) {
  const reads: RequestKey[] = [], decisions: (RequestKey & { action: string })[] = [];
  let pending = 0;
  await page.route("**/auth/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    // These tokens are generated below exclusively for this fixture, never accepted by a server.
    const token = route.request().headers().authorization?.replace(/^Bearer /, "");
    const userId = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub : undefined;
    const headers = { "access-control-allow-origin": "*" };
    if (path.endsWith("/user")) {
      await route.fulfill({ headers, json: { id: userId, email: "fixture@example.invalid", app_metadata: {}, user_metadata: {} } });
      return;
    }
    const match = path.match(/\/oauth\/authorizations\/([^/]+)(\/consent)?$/);
    if (!match) throw new Error("Unexpected Auth fixture request");
    const key = { id: match[1], userId };
    if (match[2]) {
      decisions.push({ ...key, action: route.request().postDataJSON().action });
      // Auth v2.197.0 skips a locked authorization row; overlapping details reads can yield 404.
      await route.fulfill({
        status: pending ? 404 : 200, headers,
        json: pending
          ? { code: "oauth_authorization_not_found", message: "authorization not found" }
          : { redirect_url: new URL("/fixture-callback", page.url()).href },
      });
      return;
    }
    reads.push(key);
    pending++;
    try { await route.fulfill({ headers, json: await reply(key) }); } finally { pending--; }
  });
  return { reads, decisions };
}

async function session(page: Page, userId = userA) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const access_token = `${header}.${Buffer.from(JSON.stringify({ exp, sub: userId })).toString("base64url")}.c3ludGhldGlj`;
  await page.evaluate(async access_token => {
    const modulePath = "/src/lib/supabase.ts";
    const { supabase } = await import(modulePath);
    const { error } = await supabase.auth.setSession({ access_token, refresh_token: "synthetic-refresh" });
    if (error) throw new Error(`Synthetic session setup failed: ${error.name}`);
  }, access_token);
}

test("로그인·OAuth 동의의 긴 주소와 중요 안내는 320~1440px에서 읽힌다",async({page},info)=>{
  const f=await authFixture(page,async()=>({...details("긴 에이전트 이름 ".repeat(8)),redirect_uri:"https://example.invalid/callback?query="+"longvalue".repeat(15)}));
  await page.goto("/login");await expect(page.getByRole("heading",{name:"로그인",exact:true})).toBeVisible();
  for(const width of [320,360,390,639,640,768,1024,1440]){
    await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const heading=page.getByRole("heading",{name:"로그인",exact:true}),action=page.getByRole("button",{name:"Google로 로그인",exact:true});expect(await heading.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(await action.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)));
  }
  await session(page);await page.goto("/oauth/consent?authorization_id=layout");await expect(page.getByRole("button",{name:"승인",exact:true})).toBeVisible();
  for(const width of [320,360,390,639,640,768,1024,1440]){
    await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByText("직접 시작한 연결이 아니거나 돌아갈 주소를 모르면 거부하세요.",{exact:false})).toBeVisible();
    for(const name of ["승인","거부"]){const box=(await page.getByRole("button",{name,exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
    if(width===390)await page.screenshot({path:info.outputPath("consent-hierarchy-390.png")});
  }
  expect(f.decisions).toHaveLength(0);
});
async function changeRequest(page: Page, id: string) {
  await page.evaluate(id => {
    history.pushState(null, "", `/oauth/consent?authorization_id=${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, id);
}

test("StrictMode shares one details request before an approval decision", async ({ page }) => {
  let count = 0;
  const f = await authFixture(page, async () => {
    count++;
    // Keep a duplicate read open across the first response and immediate approval.
    if (count > 1) await new Promise<void>(resolve => setTimeout(resolve, 1000));
    return details("Fixture agent");
  });
  await page.goto("/login"); await session(page);
  await page.goto("/oauth/consent?authorization_id=first");
  await expect(page.getByText("Fixture agent", { exact: true })).toBeVisible();
  expect(f.reads).toEqual([{ id: "first", userId: userA }]);
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page).toHaveURL(/\/fixture-callback$/);
  expect(f.decisions).toEqual([{ id: "first", userId: userA, action: "approve" }]);
});

test("a late previous authorization redirect cannot replace current consent", async ({ page }) => {
  const old = Promise.withResolvers<object>();
  const f = await authFixture(page, key => key.id === "old" ? old.promise : Promise.resolve(details("New agent")));
  await page.goto("/login"); await session(page);
  await page.goto("/oauth/consent?authorization_id=old");
  await expect.poll(() => f.reads.length).toBe(1);
  await changeRequest(page, "new");
  await expect(page.getByText("New agent", { exact: true })).toBeVisible();
  const delivered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/authorizations/old"));
  old.resolve({ redirect_url: new URL("/stale-callback", page.url()).href });
  await (await delivered).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/authorization_id=new$/);
  await expect(page.getByText("New agent", { exact: true })).toBeVisible();
  expect(f.reads).toEqual([{ id: "old", userId: userA }, { id: "new", userId: userA }]);
});

test("changing session user reloads details and ignores the previous user response", async ({ page }) => {
  const old = Promise.withResolvers<object>();
  const f = await authFixture(page, key => key.userId === userA ? old.promise : Promise.resolve(details("User B agent")));
  await page.goto("/login"); await session(page);
  await page.goto("/oauth/consent?authorization_id=same");
  await expect.poll(() => f.reads.length).toBe(1);
  await session(page, userB);
  await expect(page.getByText("User B agent", { exact: true })).toBeVisible();
  const delivered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/authorizations/same"));
  old.resolve(details("User A agent"));
  await (await delivered).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText("User A agent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("User B agent", { exact: true })).toBeVisible();
  expect(f.reads).toEqual([{ id: "same", userId: userA }, { id: "same", userId: userB }]);
});
