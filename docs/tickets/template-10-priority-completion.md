# Template-10 — 잔여 구현·검증·운영 반영

작성: 2026-10-04
상태: 진행 중
검토 기준: `46f4cbef3c8098626647055ec741463eb1aa3066`
선행: Template-09 PR #73 완료

## 목표와 기준 문서

사용자는 남은 작업 가운데 T02-5 도메인 전환과 T02-6 초기화·출시 준비를 제외하고 모두 우선순위대로 진행하도록 지시했다. 이 요청으로 T02-4 보류를 해제한다. 기존 운영 프로젝트와 Pages의 검증한 변경 반영도 포함한다. 새 프로젝트·Book 전환·출시 자동화·백업 복원 연습은 수행하지 않는다. [PRD](../product/concept.md)·[ADR](../adr/README.md) 안의 확정 계약을 구현하며 이탈이 필요한 결정은 사람에게 변경안으로 인계한다.

## 작업과 완료 조건

- [ ] 기록·원칙·태그의 실제 업무와 HTTP/MCP 오류에 빠른 검사를 확대한다.
- [ ] 확정 Entity 계약의 DB·HTTP·MCP·웹과 관련 항목 조회를 구현한다.
- [ ] 활동 목록 왕복 복원과 키보드·반응형·초점 검증 공백을 보강한다.
- [ ] 같은 제품 스킬을 사용하는 Claude/Codex 플러그인을 패키징하고 가능한 실제 설치·행동을 검증한다.
- [ ] 개발 세션 생성·재개 및 대표 품질/비용 평가의 확인 가능한 범위를 기록한다.
- [ ] 검증한 main revision을 기존 운영 서비스에 호환 순서로 반영하고 읽기·최소 점검 결과를 기록한다.
- [ ] 작은 PR마다 독립 리뷰·필수 CI·최신 main·머지 조건을 확인한다.

## PR 분할 계획

| 순서 | 브랜치 | 결과 | 기준 |
| --- | --- | --- | --- |
| 1 | `codex/fast-knowledge` | 서비스 없는 기록·원칙·태그 연결/handler 검사 | [Template-10-01](template-10-01-fast-knowledge.md)·Template-08·보안·workflow |
| 2 | `codex/example-entity` | 단일 Entity CRUD·연결 조회·웹·샘플 | T02-1 Entity·T02-4 |
| 3 | 후속 배정 | 활동 목록 복원·접근성 검증 | 디자인 가이드 |
| 4 | 후속 배정 | 제품 패키지·실클라이언트와 모델 평가 | 배포·Template-05 |
| 5 | 후속 배정 | 기존 운영 반영 기록 | 배포 방법·운영 방법 |

## 검증

실제 package/CI의 `test:fast`·문서·Deno·경계·build와 격리 integration CI를 사용한다. 공유 로컬 Supabase는 한 세션만 담당하며 운영 DB를 테스트 대신 쓰지 않는다. 실제 기기·스크린리더·사람의 OAuth 조작·미노출 backend metadata는 수행 여부를 구분한다. 미실행을 성공으로 표시하지 않는다.

## 구현 인계와 완료 기록

| 작업 | 담당 | 작업 공간·소유 | 모델·강도 | 의존성 |
| --- | --- | --- | --- | --- |
| 빠른 검사 | `/root/implement_fast_knowledge` | fast-knowledge worktree; 새 fast 검사·자식 티켓·현재 요약 | desktop `gpt-6.1-sol`/medium; 확정 계약의 일반 검증 | 새 Entity 파일 편집 없음 |
| Entity | `/root/implement_entity` | example-entity worktree; Entity 수직 기능·자식 티켓 | desktop `gpt-6.1-sol`/medium; 확정 계약의 일반 구현 | 기존 fast 검사 편집 없음; 최신 main 통합은 제출 전 |
| 조정 | 메인 | Git/PR·계약·독립 리뷰·CI·머지·운영 범위 | 현재 세션 | 양쪽 공유 환경 순차 |

2026-10-04 메인이 현재 desktop 도구 카탈로그의 모델/강도를 조회해 저장소 밖 `overnight-desktop-snapshot.json`을 만들고 balanced/medium 배정 preflight 통과를 인계했다. backend 실제 모델/effort·개별 비용은 미노출이며 목록과 실제 실행을 구분한다. 새 checkout에서 의존성 미설치로 첫 preflight가 실패한 뒤 기존 설치 checkout에서 재실행해 통과했다.

첫 fast 업무 조각은 [Template-10-01](template-10-01-fast-knowledge.md)에서 구현·로컬 검증·확인한 제한을 추적한다. 전체 단계의 완료가 아니며 독립 리뷰·최종 CI·머지는 제출 후 확인한다.

Template-09는 [PR #73 완료 기록](https://github.com/kimyongin/agent-workspace-template/pull/73#issuecomment-5972743090)과 checks에 따라 완료다. 제출 당시 기록은 보존한다.
