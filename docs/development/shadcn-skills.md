# shadcn/ui 공식 개발 스킬

Tailwind·shadcn/ui의 도입, 컴포넌트 추가·수정, 테마·디자인 시스템 작업에는 [공식 스킬 정본](../../.agents/skills/shadcn/SKILL.md)을 읽는다. 개발 방법과 명세·티켓·리뷰는 기존 [Matt Pocock 스킬](matt-skills.md)이 담당하고, 제품 의미와 화면 동작은 [디자인 가이드](../design/guide.md)를 따른다.

## 설치와 출처

- 공식 저장소: [shadcn-ui/ui](https://github.com/shadcn-ui/ui/tree/d2fba50ee5b9113008b5bb908563527b7efd2f27/skills/shadcn)
- 고정 revision: `d2fba50ee5b9113008b5bb908563527b7efd2f27`
- 원본 디렉토리: `skills/shadcn`. 참조 문서·자산·검사 스크립트·표시 정보까지 원본 그대로 보존한다.
- Codex 정본: `.agents/skills/shadcn/`. Claude 연결: `.claude/skills/shadcn/SKILL.md`.
- [출처와 원본 파일 SHA-256](shadcn-skills-source.json), [MIT 라이선스](shadcn-skills-LICENSE).

이 스킬은 개발용이다. 앱 사용자용 `plugins/workspace` 패키지와 분리한다. 스킬 설치와 앱의 Tailwind·shadcn 라이브러리 초기화·화면 전환은 별도 작업이다. 실제 구현과 검증 상태는 GitHub 이슈·PR에서 확인한다.

## 프로젝트에 적용

공식 스킬의 frontmatter와 본문·상대 경로를 보존한다. Claude 연결은 원본 frontmatter와 정본을 읽는 문장만 가진다. 클라이언트가 스킬의 셸 치환 표기를 실행한다고 가정하지 않으며, 필요한 CLI 조회는 사용하는 클라이언트의 도구로 직접 실행한다.

구현 전에 프로젝트의 실제 `components.json`과 CLI 진단을 확인하고, 추가할 컴포넌트의 공식 문서와 생성될 변경을 읽는다. 아직 초기화되지 않은 프로젝트의 구성은 초기 도입 작업에서 확정한다. 새 앱 생성 명령으로 현재 저장소를 교체하지 않는다.

일반 UI의 공급자는 공식 `@shadcn` 레지스트리를 사용한다. 다른 레지스트리의 채택은 별도 선택이다. 2026-10-17 사용자 합의에 따라 UI 전환은 shadcn의 디자인과 컴포넌트를 적극적으로 사용하며 기존 색·크기·배치·시각 토큰의 재현을 목표로 삼지 않는다. 개인 화면 배율, 초안 보호, 태그 독립 연결과 보기·편집에서 읽을 정보 같은 업무 계약을 이어받고 새 공통 부품으로 표현한다. 기존 디자인 문서의 구체적인 시각 값은 전환 구현과 함께 새 기준으로 정리한다.

## 갱신과 검증

원본 스킬 갱신은 고정 revision의 차이를 검토해 참조 자료와 출처·해시·라이선스를 함께 갱신한다. 앱 UI 컴포넌트의 upstream 갱신은 공식 CLI의 미리보기와 diff로 로컬 수정 사항을 대조한다.

정본·Claude 연결·문서 링크는 `check:docs`가 검사한다. 원본 일치는 출처 manifest의 SHA-256으로 확인한다. 스킬의 다음 턴 발견, CLI 프로젝트 진단, 실제 화면 구현의 브라우저 검증은 각각 확인하며 정적 검사만으로 사용 성공을 주장하지 않는다.
