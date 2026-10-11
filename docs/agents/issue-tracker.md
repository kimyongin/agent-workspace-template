# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## 작업 규모와 계획 진입

구현 요청은 변경의 의미와 불확실성으로 분류한다. 파일 수·예상 시간·작업 이름만으로 크기를 판정하지 않는다.

- **국소 수정**: 범위와 완료 조건이 분명한 문구·스타일·원인이 확인된 국소 버그는 스펙·티켓 생성 없이 바로 진행한다. 여러 파일의 단순한 기계적 이름 변경도 이 범위에 들 수 있다. 작은 작업마다 분류표나 계획 문서를 작성할 필요는 없다.
- **큰 구현**: 여러 기능을 함께 바꾸거나 공통 구조·공개 계약·저장 모델을 재설계하는 작업, 단계별 의존성 관리가 필요한 작업, 중요한 범위·제품 결정이 남은 작업은 기존 스펙·티켓을 찾거나 작성한 뒤 구현한다. 한 파일의 변경이어도 이 조건에 해당할 수 있다. 기계적 변경도 호출자 전환·호환성 유지 등 단계별 의존성이 있으면 큰 구현으로 다룬다.
- **조사와 전환**: 단순 질의·리뷰·원인 조사는 구현 계획 없이 시작할 수 있다. 버그 진단으로 해결 범위를 확인하고, 국소 수정이 큰 구현으로 확대되면 구현 범위를 더 넓히기 전에 스펙·티켓으로 전환한다. 버그라는 이름만으로 국소 수정으로 취급하지 않는다.

이미 합의된 결정과 기존 스펙·티켓을 재사용한다. 기존 작업을 이어갈 때는 요구·결정과 현재 checkout의 구현 상태를 대조하고, 남은 범위가 기존 계획에 포함되면 그 계획으로 진행한다. 새 범위가 생기면 해당 스펙·티켓에 반영한다.

큰 구현은 목적·범위·완료 조건·검증 기준과 실제 의존성이 드러난 스펙·티켓을 갖춘 뒤 시작한다. 작성 방법과 합의 절차는 원본 [to-spec](../../.agents/skills/to-spec/SKILL.md)·[to-tickets](../../.agents/skills/to-tickets/SKILL.md), 구현은 [implement](../../.agents/skills/implement/SKILL.md)·[implement-spec](../../.agents/skills/implement-spec/SKILL.md)이 담당한다. 이 기준은 사용자가 합의한 프로젝트 제약이며 원본 스킬의 호출 정책과 [문서 소유권](../adr/0011-matt-skills-and-github-workflow.md)을 유지한다.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file>`. Prepare exact multi-line Markdown in a UTF-8 file.
- **Read an issue**: when a number is given, read it directly with `gh issue view <number> --json number,title,state,body,labels`. Read comments when they may contain decisions, corrections, dependencies, or execution evidence; use `gh issue view <number> --comments` for that discussion. A skill requiring the full body and comments takes precedence over this staged lookup. A recent comment alone does not replace the agreed requirements.
- **List issues**: first choose the relevant work with `gh issue list --state open --limit 30 --json number,title,state,labels,url`, using appropriate search, label, and state filters. Fetch the selected issues' bodies and discussions next. Expand the limit or paginate when the requested scope requires it; a limited list is not an exhaustive result.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --limit 30 --json number,title,labels,author,authorAssociation,url` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`). Read the selected PRs' bodies, comments, and diffs according to the calling skill; expand the list when needed.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

## This project

Current repository: `kimyongin/agent-workspace-template`. Confirm the actual remote in a new domain app and update this setup. On Windows, prepare exact multi-line Markdown in a UTF-8 file and pass `--body-file` instead of interpolating shell text.

New and ongoing work is canonical on GitHub. Historical decisions and execution evidence remain in Git history and GitHub issues/PRs.
