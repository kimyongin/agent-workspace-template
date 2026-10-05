import { createHash } from 'node:crypto';

export const roundtripModes = ['roundtrip-entity', 'roundtrip-task', 'roundtrip-task-read', 'roundtrip-principle-read'];
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const omit = (v, keys) => Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => !keys.includes(k)));
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const digestRoundtrip = state => createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
export const emptyRoundtrip = state => state.current?.current === null && ['entities', 'tasks', 'records', 'principles', 'tags'].every(k => state[k]?.length === 0);

function entityProjection(entity, state) {
  return ['tasks', 'records', 'principles'].every(kind => {
    if (entity[kind] === undefined) return true;
    const rows = state[kind].filter(row => kind === 'principles' ? row.entity_id === entity.id : row.entity_ids?.includes(entity.id));
    const items = rows.toSorted((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)).slice(0, 5).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
    return equal(entity[kind], { count: rows.length, items });
  });
}

// Complete get_* originals, not lists/search snippets or the model's answer.
export function verifyRoundtrip(before, after, fixture, mode) {
  if (mode.endsWith('-read')) return { pass: equal(before, after), unchanged: equal(before, after), originalReads: true, newIds: {} };
  const intent = fixture.roundtrip.intent ?? {}, kinds = ['entities', 'tasks', 'records', 'principles', 'tags'];
  const newIds = Object.fromEntries(kinds.map(k => [k, after[k].filter(v => !before[k].some(old => old.id === v.id)).map(v => v.id)]));
  const created = Object.fromEntries(kinds.map(k => [k, after[k].filter(v => newIds[k].includes(v.id))]));
  const events = created.records.filter(r => r.record_kind === 'change');
  const singular = mode.includes('entity') ? 'entity' : mode.includes('principle') ? 'principle' : mode === 'web-source' || mode === 'web-memo' ? 'record' : 'task';
  const plural = singular === 'entity' ? 'entities' : singular + 's';
  const action = ['web-entity', 'web-source', 'web-principle', 'roundtrip-task'].includes(mode) ? 'create' : mode === 'web-complete' ? 'complete' : mode === 'web-principle-delete' ? 'delete' : 'update';
  const target = action === 'create' ? created[plural].find(row => singular === 'record' ? row.record_kind === 'user' : true) : after[plural].find(row => row.id === intent.id);
  const old = before[plural].find(row => row.id === intent.id);
  const id = target?.id ?? (action === 'delete' ? old?.id : null);
  const expectedEvents = ['web-complete', 'web-memo'].includes(mode) ? 0 : 1;
  let scope = Boolean(id) && events.length === expectedEvents && equal(before.tags, after.tags);
  const eventTarget = target ?? old;
  const eventEntities = singular === 'entity' ? [id] : eventTarget?.entity_ids ?? [];
  if (expectedEvents) scope &&= events.every(e => e.change?.target_kind === singular && e.change.target_id === id && e.change.target_title === (eventTarget?.prop1 ?? eventTarget?.title) && e.change.action === action && e.change.source === (mode.startsWith('web-') ? 'http' : 'mcp') && e.change.path === (action === 'delete' ? null : `/${plural}/${id}`) && typeof e.change.event_id === 'string' && e.change.event_id.length > 0 && e.change.before === null && e.change.after === null && equal(e.entity_ids, eventEntities) && (intent.memoBody === undefined || e.body === intent.memoBody));
  for (const kind of kinds) {
    const expected = kind === 'records' ? expectedEvents + (mode === 'web-source' || mode === 'web-complete' ? 1 : 0) : kind === plural && action === 'create' ? 1 : 0;
    scope &&= created[kind].length === expected;
    scope &&= after[kind].length === before[kind].length + expected - (kind === plural && action === 'delete' ? 1 : 0);
    for (const previous of before[kind]) {
      const current = after[kind].find(v => v.id === previous.id);
      if (kind === plural && previous.id === id && action === 'delete') { scope &&= !current; continue; }
      if (!current) { scope = false; continue; }
      let mutable = kind === 'entities' ? ['tasks', 'records', 'principles'] : [];
      if (kind === plural && previous.id === id && action !== 'create') {
        mutable = [...mutable, 'version', 'updated_at', ...(mode === 'roundtrip-entity' ? ['prop2'] : mode === 'web-complete' ? ['status', 'completed_at', 'result_record_id', 'result_record'] : mode === 'web-principle-update' ? ['body', 'saved_at'] : ['body'])];
        scope &&= current.version === previous.version + 1;
        if (mode === 'web-principle-update') scope &&= stamp(current.saved_at) && Date.parse(current.saved_at) >= Date.parse(previous.saved_at);
      }
      scope &&= equal(omit(previous, mutable), omit(current, mutable));
      if (kind === 'entities') scope &&= entityProjection(current, after);
      if (kind === 'tasks' && mode === 'web-memo') scope &&= equal(previous, current); // result summary unchanged for a body-only edit.
    }
  }
  if (singular !== 'principle') scope &&= equal(before.current, after.current) && equal(before.principles, after.principles);
  else scope &&= equal(after.current.current, action === 'delete' ? null : target);
  let content = false;
  if (mode === 'web-entity') content = target?.prop1 === fixture.marker && target.prop2 === 7 && target.prop3 === '2026-10-06' && target.prop4 === 'b' && entityProjection(target, after);
  if (mode === 'roundtrip-entity') content = target?.prop2 === 11 && events[0]?.body === intent.memoBody;
  if (mode === 'web-source') content = target?.title === `${fixture.marker}-source` && target.body === intent.body && equal(target.entity_ids, [fixture.entity.id]);
  if (mode === 'web-principle') content = target?.title === `${fixture.marker}-principle` && target.body === intent.body;
  if (mode === 'web-principle-update' || mode === 'web-memo') content = target?.body === intent.body;
  if (mode === 'web-principle-delete') content = !target && after.current.current === null;
  if (mode === 'roundtrip-task') content = target?.title === `${fixture.marker}-task` && target.kind === 'once' && target.status === 'open' && target.summary === intent.summary && target.body === intent.body && equal(target.entity_ids, [fixture.entity.id]);
  if (mode === 'web-complete') {
    const result = created.records.find(r => r.record_kind === 'result');
    content = old?.status === 'open' && target?.status === 'done' && stamp(target.completed_at) && result?.body === intent.body && result.task_id === id && result.id === target.result_record_id && equal(result.entity_ids, [fixture.entity.id]) && equal(target.result_record, { id: result.id, title: result.title, summary: result.summary });
  }
  return { pass: Boolean(scope && content), scope: Boolean(scope), content: Boolean(content), originalReads: true, targetId: id, newIds, automaticChanges: events.length };
}

export async function beginRoundtripPhase(journal, save, before, mode, intent) {
  if (journal.roundtrip.pending) throw new Error('Unresolved phase: reconcile originals or clean up, never blindly replay');
  journal.roundtrip.intent = intent;
  journal.roundtrip.pending = { mode, before, intent };
  await save();
}
export async function finishRoundtripPhase(journal, save, after) {
  const pending = journal.roundtrip.pending;
  if (!pending) throw new Error('Missing durable phase intent');
  const proof = verifyRoundtrip(pending.before, after, journal, pending.mode);
  for (const kind of ['entities', 'tasks', 'records', 'principles', 'tags']) journal.roundtrip.owned[kind] = [...new Set([...(journal.roundtrip.owned[kind] ?? []), ...(proof.newIds[kind] ?? [])])];
  if (proof.pass) { journal.roundtrip.completed.push(pending.mode); delete journal.roundtrip.pending; }
  await save();
  return proof;
}

export function roundtripPrompt(mode, f) {
  const context = `Workspace에서 ${f.marker}의 대상과 판단 기준, 이전 근거 원문을 확인해 줘. `;
  const request = {
    'roundtrip-entity': `대상의 속성 2만 7에서 11로 바꾸고 다른 속성은 보존해 줘. 변경 기록의 최종 메모 본문은 "${f.roundtrip.intent.memoBody}"로 남겨 줘.`,
    'roundtrip-task': `이 대상에 일회성 할 일 하나를 등록해 줘. 제목은 "${f.marker}-task", 요약은 "${f.roundtrip.intent.summary}", 본문은 "${f.roundtrip.intent.body}"로 해 줘. 이번에는 등록만 하고 완료하지 마.`,
    'roundtrip-task-read': `완료한 할 일 ${f.task?.id}와 그 결과 기록의 원문을 살펴보고 상태와 결과 본문, 다시 열 수 있는 식별 정보를 알려 줘. 저장은 하지 마.`,
    'roundtrip-principle-read': `지금 판단 기준과 ${f.originalDetail}가 있는 과거 기록 원문을 비교해 줘. 각각 어떤 수치 조건인지 설명하고 다시 열 수 있는 식별 정보를 알려 줘. 저장은 하지 마.`,
  }[mode];
  if (!request) throw new Error('Unknown roundtrip native phase');
  return context + request + ' 요청한 것 외에는 변경하지 마. 검색 반영을 확인하지 못했다면 완료로 추정하지 마.';
}

export function assessRoundtripNative(e) {
  const failures = [];
  for (const [name, ok] of Object.entries({ 'native-exit': e.exitCode === 0, 'shared-skill-read': e.completedSkillRead, 'actual-original-read': e.originalSourceRead, 'independent-public-contract': e.independent?.pass, 'current-principle-read': e.mode !== 'roundtrip-principle-read' || e.currentPrincipleRead, 'done-task-read': e.mode !== 'roundtrip-task-read' || e.completedTaskRead, 'read-only-native': !e.mode.endsWith('-read') || e.mutationCalls === 0 })) if (!ok) failures.push(name);
  if (e.answer?.indexStatements?.affirmative) failures.push('unverified-index-completion');
  return { pass: failures.length === 0, failures };
}

export function hasRoundtripOriginal(tool, payload, kind, original) {
  const allowed = kind === 'principle' ? ['get_current_principle', 'get_principle', 'list_principles'] : ['get_task', 'list_tasks'];
  if (!allowed.includes(tool) || !original || !payload) return false;
  if (typeof payload === 'string') { try { return hasRoundtripOriginal(tool, JSON.parse(payload), kind, original); } catch { return false; } }
  if (typeof payload !== 'object') return false;
  const keys = kind === 'principle' ? ['id', 'body', 'version', 'is_current'] : ['id', 'body', 'version', 'status', 'result_record_id', 'result_record'];
  if (keys.every(k => equal(payload[k], original[k]))) return true;
  return Object.values(payload).some(v => hasRoundtripOriginal(tool, v, kind, original));
}
