import { createHash } from 'node:crypto';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const error = (rpc, message) => ({ jsonrpc: '2.0', id: rpc.id, result: { isError: true, structuredContent: { code: 'unavailable', message, retryable: true }, content: [{ type: 'text', text: JSON.stringify({ code: 'unavailable', message, retryable: true }) }] } });

// Local adapter only: no server changes, forged success or substituted inputs.
export function savingFaultAdapter(mode) {
  if (!['save-failure', 'save-response-loss'].includes(mode)) throw new Error('Unknown saving fault');
  let injected = 0, upstreamMutations = 0, attempts = 0, replayCalls = 0, replayConfirmed = false, inputHash, requestIdHash, committedId, mismatched = false, originalConfirmation = false, originalReadConfirmation = false;
  return {
    async call(rpc, forward) {
      const name = rpc?.method === 'tools/call' ? rpc.params?.name : '';
      const mutation = /^(create_|update_|delete_|save_|correct_|complete_|record_occurrence|resume_|stop_|rename_)/.test(name ?? '');
      if (mutation && mode === 'save-failure') { attempts++; injected = 1; return error(rpc, '저장 요청은 원본 서비스에 전달되지 않았습니다. 현재 연결 장애로 저장할 수 없습니다.'); }
      if (mutation) {
        attempts++;
        const input = rpc.params?.arguments;
        if (name !== 'create_record' || typeof input?.request_id !== 'string' || !input.request_id) return error(rpc, '이번 시험은 원래 단일 기록 요청의 재시도 식별 정보가 필요합니다. 변경은 전달되지 않았습니다.');
        const signature = hash({ name, input });
        if (inputHash && signature !== inputHash) { mismatched = true; return error(rpc, '응답을 잃은 원래 요청과 입력 또는 요청 식별 정보가 다릅니다. 중복 저장을 방지하기 위해 전달하지 않았습니다.'); }
        const replay = injected === 1;
        if (replay) replayCalls++;
        const result = await forward(rpc);
        if (!result?.result || result.result.isError || result.error) return result;
        const stored = result.result.structuredContent;
        if (!stored?.id) return result;
        upstreamMutations++;
        if (!injected) { inputHash = signature; requestIdHash = hash(input.request_id); committedId = stored.id; injected = 1; return error(rpc, '원본 서비스에 전달한 뒤 응답을 잃었습니다. 저장 여부가 불확실합니다. 원문 조회 또는 동일 입력과 동일 요청 식별 정보로 확인하세요.'); }
        replayConfirmed ||= replay && stored.id === committedId;
        originalConfirmation ||= replayConfirmed;
        return result;
      }
      const result = await forward(rpc);
      const data = result?.result?.structuredContent;
      const original = row => row?.id === committedId && typeof row.body === 'string' && Number.isInteger(row.version);
      if (!result?.result?.isError && (name === 'get_record' && original(data) || name === 'list_records' && data?.items?.some(original))) { originalConfirmation = true; originalReadConfirmation = true; }
      return result;
    },
    evidence: () => ({ mode, injected, upstreamMutations, attempts, replayCalls, requestIdHash: requestIdHash ?? null, sameInputRetry: Boolean(replayCalls > 0 && replayConfirmed && !mismatched), inputChanged: mismatched, originalReadConfirmation, originalConfirmation }),
  };
}
