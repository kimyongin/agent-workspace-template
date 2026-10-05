// Real browser consent with experiment DCR identity persisted before authorization.
import { createHash, randomBytes } from 'node:crypto';
export async function ownedConsent(page, env, journal, save) {
  const auth = `${env.VITE_SUPABASE_URL}/auth/v1`, redirect = 'http://127.0.0.1:55390/callback';
  journal.oauthRegistrationAttempt = { client_name: journal.marker, redirect_uris: [redirect], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }; await save();
  const registered = await fetch(`${auth}/oauth/clients/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(journal.oauthRegistrationAttempt) });
  const reg = await registered.json();
  if (!registered.ok || !reg.client_id) throw new Error('Own DCR failed; raw auth payload omitted');
  journal.oauthClientId = reg.client_id; delete journal.oauthRegistrationAttempt; await save();
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(16).toString('base64url');
  const url = new URL(`${auth}/oauth/authorize`);
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: journal.endpoint })) url.searchParams.set(key, value);
  let callback;
  await page.route(`${redirect}**`, route => { callback = new URL(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }); });
  const appOrigin = new URL(page.url()).origin, authorization = await fetch(url, { redirect: 'manual' });
  await authorization.body?.cancel();
  const consent = new URL(authorization.headers.get('location') ?? '', env.VITE_SUPABASE_URL);
  if (consent.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(consent.hostname) || consent.pathname !== '/oauth/consent') throw new Error('Expected local consent redirect');
  await page.goto(new URL(`${consent.pathname}${consent.search}`, appOrigin).href);
  await page.getByRole('heading', { name: '에이전트 연결 승인' }).waitFor();
  await page.getByRole('button', { name: '승인', exact: true }).click();
  await page.waitForURL(current => current.origin === new URL(redirect).origin && current.pathname === '/callback');
  if (callback?.searchParams.get('state') !== state || !callback.searchParams.get('code')) throw new Error('Own OAuth callback mismatch');
  const response = await fetch(`${auth}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code'), redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier, resource: journal.endpoint }) });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error('Own token exchange failed; raw auth payload omitted');
  journal.token = token.access_token; await save();
  const claims = JSON.parse(Buffer.from(journal.token.split('.')[1], 'base64url').toString());
  journal.ownerId = claims.sub; await save();
  if (claims.sub !== journal.authUserId || claims.client_id !== journal.oauthClientId || claims.exp * 1000 <= Date.now()) throw new Error('Synthetic token identity/expiry mismatch');
}
