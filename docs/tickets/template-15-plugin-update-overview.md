# Template-15 — 플러그인 갱신 경로와 협업 역할 안내

작성: 2026-10-04
상태: 진행 중(문서 구현·로컬 검사 완료, 독립 리뷰·CI·머지 대기)
검토 기준: base `68f5d0fd0b765cfe07448d7c5673405470f8eafe`, branch `codex/plugin-update-overview`
선행: [Template-14 개요 정리와 역할 제안](template-14-overview-reader-guide.md)

## 승인·소유

사용자는 현재 플러그인 배포 방식을 설명하고 앞으로 웹 UI 배포를 사용하지 않으며 `plugin-creator:update-plugin` 스킬을 적용하도록 요청했다. Template-14의 멀티·서브세션 역할 설명 적용도 승인했다. 구현 담당은 overview·배포 방법·Workspace README·공통 개발 스킬·이 티켓을 소유하고 메인은 독립 리뷰·PR/CI·머지를 맡는다. 같은 고정 `gpt-6.1-sol`/medium 배정과 메인이 완료한 당일 desktop balanced/medium implement preflight를 유지한다. 실제 checkout은 clean이고 다른 작업자의 변경을 되돌리지 않는다.

이번 범위는 문서만 수정한다. 계정 게시·실제 업데이트/설치·버전 변경·서비스 배포·모델 정책·CI 분류기·PRD/ADR 변경은 수행하지 않는다. 과거 Claude 웹 검증 기록도 수정하지 않는다.

사용자는 역할 설명에 모델 지정도 포함하는지 추가로 확인한 뒤, 새 설명에는 구체 모델명·추론 강도를 넣지 말고 ‘각 세션의 역할과 작업 난이도에 맞는 모델을 선택합니다’ 수준으로 정정했다. 이 최종 정정을 반영해 새 블록은 짧은 원칙과 정본 링크만 남기며 기존 모델 FAQ는 변경하지 않는다. 모델 정책 자체도 바꾸지 않는다.

## 계약·구현

- [x] 설치된 `plugin-creator:update-plugin`과 account updates/local plugins 참조를 읽고 소유 원본별 라우팅을 배포 정본에 반영한다.
- [x] Workspace0.1.1 로컬/Git 원본과 eligible 계정 플러그인을 구분한다. 계정 도구는 확인된 backend plugin ID/current release/편집 가능 scope만 사용한다.
- [x] 원본 수정·지원 CLI 갱신/재설치·cache 직접 편집 금지와 웹/앱 UI 설치·갱신·게시 금지를 정본·README·개발 스킬에 반영한다. 미지원이면 그 한계를 기록한다.
- [x] overview는 세 역할·본 대화에서 결과 확인·독립 병렬/의존 순차·필요 통합 담당과 짧은 배포 개념만 추가한다. 상태·PR·수치·명령은 누적하지 않는다.
- [x] 문서/diff·CI 영향·넓은/좁은 화면 렌더링을 확인하고 커밋 인계한다.
- [ ] 독립 리뷰·CI·머지(메인 후속).

실제 소유 원본 `plugins/workspace/plugin.json`·`.claude-plugin/plugin.json`의 버전0.1.1과 README의 로컬/Git 경로를 확인했다. 현재 Codex0.160.0의 `plugin --help`, `plugin marketplace --help`, `plugin add --help`와 Claude2.1.289의 `plugin --help`·`plugin marketplace --help`를 읽기 전용으로 실행했다. Codex add/list·Git marketplace upgrade, Claude update/marketplace update가 노출된다. 실제 설치·갱신 성공이나 Desktop 반영을 이번 help만으로 주장하지 않는다. 기존 README의 구버전 격리 설치 증거는 당시 기록으로 보존한다.

공식 [Codex 패키징](https://developers.openai.com/plugins/build/plugins)과 [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces) 문서도 조회했다. 스킬의 계정 편집 경로는 Git 관리/canonical App/Sites 플러그인에 일반 적용하지 않는다. 이번 선택 원본은 저장소라 계정 목록·게시 도구를 호출하지 않았다. 권한·청중·설정·cache·제품 버전을 바꾸지 않았다.

## 검증과 인계

직접 실행: `npm run check:docs` 텍스트336개·모델/native 정합성 PASS, 회귀49개 중48 PASS/0 FAIL/기존 Windows file-symlink권한1 SKIP. `git diff --check` PASS. 실제 변경 내용을 현재 분류기로 확인해 overview markup과 plugins README 경로는 full, 배포 방법/개발 스킬은 docs, 전체 full이다. 경량 판정을 얻으려고 CI 정책을 수정하지 않았다. 문서 위험에 맞춰 앱·DB·HTTP/MCP·E2E를 로컬에서 반복하지 않고 원격 CI를 메인에게 인계한다.

headless Chromium에서 file URL로 overview를 열어1280/390px의 dark/light 네 조합을 렌더링했다. 외부 HTTP 요청을 차단해 CDN 글꼴 대신 fallback을 사용했다. 새 역할 heading 세 개와 가로 넘침 없음이 모두 PASS이고, 1280-dark/390-light screenshot을 직접 보아 역할 배치·줄바꿈을 확인했다. screenshot은 저장소 밖 `C:/Users/yongin/AppData/Local/Temp/template15-overview/`에 보존한다. 기존 script/style 블록이 byte동일함을 대조했다. 실제 휴대폰·스크린리더 또는 제품 클라이언트 검증으로 확대하지 않는다.

멀티세션을 여러 작업 대화의 협업, 서브세션을 본 대화에서 한정된 일을 맡긴 대화로 설명한다. 사람은 본 대화에서 범위·설계를 정하고 결과를 확인하며 구현·독립 리뷰의 역할을 나눠 표시했다. 공통 CSS를 재사용해 별도 스타일·script 변경은 하지 않는다. 실제 게시·새 클라이언트 행동은 범위 밖이며 문서 검증과 구분해 인계한다.
