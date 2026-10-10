# 에이전트 작업 비용 비교

[#277](https://github.com/kimyongin/agent-workspace-template/issues/277)의 네 요청을 재실행할 때만 읽는다. 요청·완료 조건의 정본은 [protocol.json](protocol.json)이다. 실행 증거와 비교 결론은 GitHub 이슈에 남긴다.

## 고정한 기준

기준 revision은 `39e0f63ab8355cafbbbe716eff2adf0817c8c46a`, 모델은 GPT-6.1 Sol medium이다. 당시 미커밋 E2E 문서 변경은 **기준선에서 제외**했다. 개선 revision에 그 변경이 들어 있으면 저장소 차이로 포함하고 별도 표시한다. [baseline-inventory.json](baseline-inventory.json)은 이 revision의 파일 내용·SHA-256·UTF-8 바이트·Unicode code point 수를 고정한다. inventoryPaths는 비교용 자료 목록, seedPaths는 대상 확인용 위치이며 에이전트에게 강제로 읽힐 자료 목록이 아니다.

이 파일은 **정적 자료 기준선**이다. 이전 에이전트 실행 로그가 없어 네 작업의 첫 수정 전 문맥, 토큰, 호출, 재작업, 완료·검증 결과는 모두 미측정이다. `null`은 0이 아니다. 파일 크기나 이 자료를 모은 호출을 실제 작업 읽기량·도구 호출로 집계하지 않는다. 실제 작업 기준선과 실제 토큰 절감은 미검증이며, 아래 paired replay가 끝나야 작업 비용을 비교할 수 있다.

## 재실행

1. 기준 revision과 비교 revision을 각각 깨끗한 일회용 checkout으로 준비한다. 새 Codex 채팅마다 해당 checkout의 루트 `AGENTS.md`, 같은 사용자 AGENTS 지침·환경 정보와 protocol의 요청문 하나만 시작 문맥으로 제공한다. 이 README·inventory·seedPaths·예상 진입 답안을 채팅에 미리 넣지 않는다. 이전 채팅, 실행 결과, diff, 계획을 넘기지 않는다. 네 요청은 독립 실행한다.
2. GPT-6.1 Sol medium을 명시한다. 양쪽의 Codex 버전, 호스트 OS, 실행 도구 이름·버전과 설치/연결 플러그인 ID 목록, 권한(sandbox·network·writable roots·approval), 시작 지침의 원문 또는 해시를 실행 증거에 먼저 저장한다. 전역 플러그인 설정을 그대로 유지하고 같은 도구 구성을 쓴다. 현재 baseline에 실행 환경 snapshot이 없으므로 이 단계에서 양쪽 snapshot을 확보하기 전에는 환경이 같다고 주장하지 않는다. 경로 차이는 대응 checkout 경로로 표준화한다.
3. 요청별 완료·검증 조건을 양쪽에 동일하게 적용한다. 필요한 문서·보안·접근성·검증을 생략해서 얻은 감소는 개선에서 제외한다. public-api는 계획을 제시하고 제품 수정 전에 종료한다. 합의된 계약 검증 interface를 재승인받는 단계는 추가하지 않는다.
4. 첫 제품 수정(계획 전용 요청은 첫 계획 산출물) 직전까지 읽힌 원문/검색 결과와 전체 실행 이벤트를 저장소 밖의 실행별 위치에 보존한다. 시작 지침, 저장소 문서·코드, 호출된 스킬, 외부/전역 지침·도구 설명, 사용자 요청을 별도 bucket으로 기록한다. 동일 자료 재읽기는 전달된 문맥 비용에 반복 포함하며, unique 자료 수도 따로 기록한다. 잘린 출력은 실제 전달 부분만 세고 원본 전체 크기를 대신 쓰지 않는다.
5. 기준→비교와 비교→기준 순서를 번갈아 요청별 최소 3쌍 실행한다. cold/warm cache, 새 채팅 여부와 provider의 cached-token 의미를 기록한다. 실패·중단·재작업 실행을 원자료에 모두 보존한다. 환경·검증 조건이 다른 실행은 이유와 함께 비교 불가로 표시한다. 실행을 늘려 실패를 덮거나 성공만 선택하지 않는다.
6. GitHub에 paired 결과와 원자료 위치/해시, 검증 revision·명령·범위·종료 결과·생략 근거를 남긴다. 호출/문자 수 분포·범위와 완료율을 나란히 보고하고 표본 3쌍으로 일반적 성능을 확정하지 않는다. provider의 실제 task telemetry가 없으면 토큰·cache는 unavailable로 남긴다. 계정 전체 사용량·추정 tokenizer 값·문자 수를 task 토큰으로 대체하거나 절감률로 환산하지 않는다.

자료 inventory는 현재 checkout의 작업 트리를 읽지 않고 지정한 Git revision만 읽는다. 다음 두 실행의 기준 출력이 같으면 정적 자료를 재수집할 수 있다. 비교 revision에서 경로가 이동·삭제되면 실패를 보존하고 대응 자료를 이슈에 기록한다. 옛 파일 경로를 소리 없이 빼지 않는다.

```sh
node experiments/agent-efficiency/inventory.mjs > /tmp/agent-baseline-a.json
node experiments/agent-efficiency/inventory.mjs 39e0f63ab8355cafbbbe716eff2adf0817c8c46a > /tmp/agent-baseline-b.json
cmp /tmp/agent-baseline-a.json /tmp/agent-baseline-b.json
cmp /tmp/agent-baseline-a.json experiments/agent-efficiency/baseline-inventory.json
node experiments/agent-efficiency/inventory.mjs <comparison-revision> > /tmp/agent-comparison.json
```

## 실행 증거 필드

각 반복을 아래 형태로 저장한다. 비밀값은 제외하고 원자료를 재확인할 수 있는 위치·해시를 사용한다. 토큰 provider가 input에 cached tokens를 포함하는지 함께 기록한다. firstOutput은 공개 계약 요청의 계획 비용을 첫 제품 수정 비용과 섞지 않기 위한 필드다.

```json
{
  "task": "copy",
  "pair": 1,
  "arm": "baseline",
  "revision": "39e0f63ab8355cafbbbe716eff2adf0817c8c46a",
  "environmentSnapshot": "external-path-and-sha256",
  "startContextSnapshot": "external-path-and-sha256",
  "transcript": "external-path-and-sha256",
  "cacheCondition": "cold-or-warm-or-unavailable",
  "firstOutput": "product-edit-or-plan",
  "beforeFirstOutput": {
    "deliveredUnicodeCodePointsByBucket": null,
    "readEvents": null,
    "uniqueSources": null
  },
  "tokens": {
    "status": "unavailable",
    "provider": null,
    "input": null,
    "output": null,
    "cachedInput": null,
    "semantics": null
  },
  "toolCalls": null,
  "rework": { "failedChecks": null, "correctiveEdits": null },
  "completion": "not-run",
  "checks": [],
  "comparability": "unmeasured",
  "differences": []
}
```

toolCalls는 실제 실행 transcript의 호출 수다. 도구 하나의 batch 안에 포함된 하위 명령·조회 수도 별도 event에 남겨 batching만으로 감소했다고 오인하지 않게 한다. correctiveEdits는 첫 완료 시도 이후 요구 누락·회귀·검사 실패를 고치기 위한 수정 event를 뜻한다. checks에는 revision·명령·범위·exit code와 not-run 이유를 적는다. 계획 전용 요청의 제품 검증은 `not-applicable(planning-only)`이며 계획의 요구·검증 범위 보존을 별도 평가한다.
