# Template-10-02 — 예제 Entity 수직 슬라이스

상태: 구현 중. 부모 `docs/tickets/template-10-priority-completion.md`(별도 fast branch에서 작성 중)의 T02-4 하위 작업이며 확정 계약은 [T02-1](template-02-t02-1-contracts.md#예제-엔터티-entity--t02-4)을 따른다. 부모 통합 후 링크를 연결한다.

## 배정과 승인 범위

- 2026-10-04 Asia/Seoul 사용자 재개 승인: T02-4. T02-5 Book·T02-6 초기화/배포 게이트는 제외.
- 구현 서브세션 `implement_entity`: base `46f4cbe`, branch `codex/example-entity`, checkout `C:/Users/yongin/.codex/worktrees/example-entity/agent-workspace-template`.
- 배정 모델 `gpt-6.1-sol`, medium. 같은 날 desktop preflight는 메인이 수행한 `TEMP/overnight-desktop-snapshot.json` 근거를 전달받음. 실제 backend 모델/effort metadata는 미노출.
- 이 세션은 Entity 계약·core·저장·migration·HTTP/MCP·UI·연결 필터·제품 스킬 안내·검증을 소유한다. 별도 fast worker와 plugin packaging worker의 파일은 수정하지 않는다. 시작 문서·overview·Template-10 부모 요약은 메인이 조정한다.
- shared local Supabase 실행 권한은 아직 배정되지 않아 실행하지 않는다. 운영 DB·배포·비용 작업은 범위 밖이다.

## 계약과 구현 범위

단일 `app.entities`에 prop1 텍스트, prop2 정수, prop3 날짜, prop4 선택과 버전·시각을 명시한다. generic payload/엔진은 만들지 않는다. Entity는 임베딩/검색 큐 대상이 아니다.

`keyword`는 prop1 대소문자 무시 부분 일치, `prop3_from`·`prop3_to`는 포함 날짜 범위, `prop4`는 선택값이며 함께 쓰면 AND다. `sort`는 기본 updated_at 내림차순, prop1/2/3은 오름차순, id가 동점 정렬 키다. 빈 숫자/날짜는 먼저 표시한다. 커서는 owner·필터·sort에 묶는다.

메인과 합의: 상세는 tasks/records/principles 각 최근 5개(updated_at desc, id desc)와 전체 count를 반환한다. 관련 목록의 entity_id로 전체 조회한다. 참조는 같은 owner여야 하고 보이지 않는 참조는 invalid_reference다. Entity 삭제는 링크만 비우고 연결 항목 version·updated_at을 갱신한다. 데이터 원문·태그·원칙 적용 연결은 보존한다. 할 일 완료 결과는 해당 할 일의 Entity 연결을 이어받으며 회차 기록은 생략 시 할 일의 연결을 이어받는다.

UI는 공통 Field/FormModal/ConfirmDialog, panel/list/action 토큰을 소비한다. Entity 목록의 URL 필터·누적 페이지·상세 복귀 초점/스크롤, 로딩·빈 결과·오류 재시도·더 보기 실패 보존과 작성/편집 초안 보존을 검증한다. 연결은 별도 관리 모달 없이 폼에서 선택한다.

## PR와 검증 계획

Entity의 실제 소비자까지 한 수직 기능 경계로 구현한다. DB→공통 유스케이스→HTTP/MCP→UI와 task/record/principle 링크가 함께 있어야 FK/참조 거부/삭제 보존 의미를 확인할 수 있어 400줄을 넘을 수 있다. 독립 기능인 플러그인 패키징·활동 목록 복원은 별도 작업이다. PR 분할 필요 시 메인과 조정한다.

- 서비스 없는 검증: npm ci, contracts/core·handler 회귀, web tests, build, Deno check/lint/fmt, boundary, docs, git diff 체크.
- 격리 실제 검증: Entity DB RLS·같은 owner FK·커서·conflict·멱등성·링크 해제와 버전 보존, 실제 인증 HTTP/MCP CRUD parity, 웹 CRUD/연결/삭제·필터·초안·반응형 E2E. 공유 로컬 환경 배정 또는 통합 CI에서 수행하고 실제 실행과 인계를 구분한다.
- Supabase 공식 문서 확인(2026-10-04 KST): changelog.md를 PowerShell Invoke-WebRequest로 조회(web 도구의 text/markdown 미지원 fallback). 최근 Database breaking change는 PostgreSQL 15.19/17.11 extension 관련 공지이며 Entity의 일반 FK/RLS에는 새 API 변경이 없음. [RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)의 grant와 policy를 함께 적용하는 기준을 확인함.
- CLI `supabase migration new example_entity`로 생성한 `20261003194119_example_entity.sql`은 UTC 2026-10-03 / KST 2026-10-04 작업이다.

## 실행 기록

- npm ci: 성공, 168 packages 설치, audit 0 vulnerabilities.
- 1차 서버 구현 후 npm run check:deno: 성공. 이후 UI·통합 테스트 추가에 따른 최종 검증은 남아 있음.
- 독립 리뷰·제출·통합 CI·머지·배포·실클라이언트 검증: 아직 수행하지 않음.
- 메인이 공유 로컬 검증 exclusive 담당을 Entity 세션에 배정함. 원본 로컬 설정 3개만 worktree로 안전 복사했고 `supabase/.env`는 복사하지 않음. `2f17a2f`로 1차 코드를 고정한 뒤 migration up --local 성공(기존 DB reset 없음).
- 기존 Edge runtime의 primary source bind mount를 확인하고 해당 runtime 하나만 stop/rm한 뒤 worktree source의 functions serve로 교체함. fin 컨테이너는 변경하지 않음.
- 1차 실제 DB 69/70, fast 7/8: 신규 테스트 fixture가 Task.status 필수 컬럼을 누락한 오류와 sync MCP handler를 assertRejects에 직접 넘긴 검사 오류 각각 1건. 구현 실패와 구분해 fixture/검사만 수정 후 재실행 예정. 실제 HTTP 17/17 통과.
