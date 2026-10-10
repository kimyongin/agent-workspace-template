# Original skill policy review — T11 / #287

**Policy review complete with measurement limits retained.** Recommendation: **KEEP the original skills, their applicability/call policy, and independent Standards/Spec review.** Available observations do not justify blanket shortening, local copies, or a new execution engine. This experimental report records evidence and alternatives; it does not add an always-loaded instruction or amend an ADR.

Measured integration revision: `f73ecf8e8072e0a11a06cec38517206bed725a85`. This policy branch incorporates T10 evidence commit `c0aa71b470f4813b487f353b6ea51e1725d23016` and integration tip `82057fab2f8a87d155ec7373e5347c01f918dfd2`. Baseline: `39e0f63ab8355cafbbbe716eff2adf0817c8c46a`. Approved T11 depends on T10. All 24 comparison runs ended: 18 local runs passed required behavior verification and 6 API planning runs retained partial remote-spec verification. T10 found no consistent savings. KEEP is the completed review conclusion; unobservable cost remains unknown rather than estimated as tokens. This does not declare the parent spec, final independent review, CI or merge complete.

## Decision ownership and guarantees

[ADR-0008](../../docs/adr/0008-document-ownership.md) assigns product meaning and expensive structural/security decisions to people. Agents maintain guides and execution within agreed decisions. Concrete conversation agreements count as approval and are reusable.

[ADR-0011](../../docs/adr/0011-matt-skills-and-github-workflow.md) assigns development methods to the 27 original Matt Pocock skills pinned at `24fe0ef7737efae15c87225755e9f6f5965e4888`. Original applicability and call policy remain intact. `.agents/skills/` is canonical, Claude files are minimal connections, and updates require upstream-diff review through a PR. Project documents provide product/environment facts and agreed constraints without recreating those methods. Independent Standards/Spec review and required CI remain merge gates.

There is no diff from baseline to the reviewed integration revision in `.agents/skills/`, `.claude/skills/`, `.codex/config.toml`, `.claude/settings.json`, ADR-0008, or ADR-0011. This report changes none of those sources. Unrelated product skills and global plugin removal are outside this review.

## Evidence and limits

The paired protocol fixes four requests, three pairs per request, baseline/improved revisions, GPT-6.1 Sol medium, and CLI 0.162.1. The data are partially controlled observational comparisons. Full injected start instructions are opaque; saved settings inventory does not prove complete injected plugin equality. Provider cache is uncontrolled. Concurrent host lanes confound elapsed time. Environment recovery and verification breadth remain part of recorded execution cost.

The measurement owner is the [T10 report](results-2026-10-10.md) and its [machine summary](results-2026-10-10.summary.json). Its final 24-run evidence is integrated with this report. Repeated token tables remain there so corrected observer values, failed runs, command counts and validation scope have one source.

The T10 report preserves actual reporting CLI `turn.completed` input/cached/output values. These are cumulative reporting-turn usage, not unique-context sizes or per-skill costs. Billing relationships are unverified; nested-agent usage is not assumed included.

All six pure-function runs passed behavior and verification assessment, read the diagnosing-bugs body and verification guide, and produced the last-message fix while preserving empty and independent paths. Improved reported input is higher in all three pairs; command counts are equal, higher, equal. Thus these observations establish no consistent reduction. They do not identify the cause as skill bodies or catalog overhead.

Copy pair 1 passed in both arms and has lower improved input, but verification differs: baseline ran 3 collection + 2 detail cases; improved ran 18 collection + 2 detail cases. Baseline also incurred more config-loader recovery. Scoped design reads therefore do not establish a causal total-cost saving. T10 corrected first-product-edit observer events against completed mutations; corrected raw output before edit remains higher in this improved run. Expected regression red is diagnosis, separately distinguished from environment failure and missing-file reads.

Raw CLI `aggregated_output` is a tool-output proxy, not verified text delivered to the model after truncation. Lexical command paths support read-route observations, but mixed commands prevent exact repository/body byte allocation. Actual model-delivered characters, source-bucket reads, and unique source counts remain `null/unknown`. First-edit exact read context remains unknown; direct CLI command counts do not reveal shell subcommands or complete tool-call totals. No character count is converted to tokens. A startup/no-tool probe reporting input 15,725, cached input 13,184, output 5 is only an aggregate probe; it cannot be attributed to the skill catalog or used as a representative baseline.

Public API planning runs preserve substantial local contract and validation content, but existing remote agreement verification is partial in all six runs. Baseline three runs and improved pair 3 encounter network failure; improved pairs 1 and 2 incorrectly interpret a checkout write restriction as prohibiting permitted GitHub reads and omit the lookup. This is an agent error, not a policy authorization limit. A local plan and CLI exit 0 do not satisfy the missing requirement. T10 retains these observations and excludes partial runs from fully verified matched savings; product implementation validation is not applicable to planning-only work.

The dataset does not experimentally remove originals or vary review policy. It does not contain a paired small AGENTS instruction edit or an isolated independent-review workload. Those work-kind costs below are qualitative source analysis, not measured workload totals.

## Distinguish the cost owners

| Layer | Observable evidence | Residual unknown / ownership |
| --- | --- | --- |
| Repository always-loaded pointers | AGENTS.md is 1,371 Unicode characters / 14 lines at integration and routes task types to owned docs. | Actual injected representation and repeated token cost are opaque. Repository guidance can evolve inside ADR decisions. |
| Skill catalog | 27 originals on disk: 11 auto-selectable and 16 explicit-only. The review agent's attached catalog exposes the 11 auto-selectable Matt entries alongside global/plugin entries. | Catalog injection is client-dependent. All installed bodies are not thereby loaded. CLI total input cannot be attributed to names/descriptions. |
| Called bodies / references | Pure-function logs mention diagnosing-bugs in all six runs. References and downstream calls add task-dependent reads. | Lexical path mentions do not measure exact delivered bytes, repeated context, cache behavior, or per-body tokens. Applicability/calls remain original-owned. |
| Repository docs/code/tool responses | Baseline pure-function runs repeatedly reach START-HERE, Matt installation and ownership ADRs; improved runs reach issue tracker and verification guidance, with some overlapping reads. | A route change can transfer reads instead of reducing them. Tool output and retries must be compared with completion and verification. |
| External runtime instructions/tools | Host instructions, global/plugin descriptions, tool schemas, provider cache, and desktop/CLI differences are distinct from repository files. | Repository-only changes cannot claim savings on unchanged external overhead; total CLI usage provides no reliable layer allocation. |

Static inventory uses Python `len(path.read_text())`, including frontmatter and final newline, at the fixed integration revision. The 27 SKILL.md files total 126,851 Unicode characters on disk; that is not per-task input. The 11 auto-selectable description source lines total 2,156 characters (all 27: 3,888), excluding runtime names/paths and including source quotation syntax. These are source proxies only.

## Benefit and cost by work kind

| Work kind | Original guidance / preserved benefit | Cost assessment |
| --- | --- | --- |
| Small instruction edit | [writing-for-agents](../../.agents/skills/writing-for-agents/SKILL.md), 10,882 characters, supplies precise context pointers, progressive disclosure, single-source ownership, and observable completion. Project size guidance allows local changes without new specs/tickets. | A long body relative to a one-line edit is a plausible residual cost, but no paired instruction-edit measurement isolates it. Previously agreed constraints avoid repeated approval. Reading every original is unnecessary. Applicable PR gates remain. |
| Implementation | [implement](../../.agents/skills/implement/SKILL.md), 433 characters, routes to TDD/review; [implement-spec](../../.agents/skills/implement-spec/SKILL.md), 2,780, owns explicit spec integration/task graphs. [tdd](../../.agents/skills/tdd/SKILL.md), 3,542 plus references, protects public seams, red-before-green, and non-tautological tests. | Shortening a router can leave downstream reads/test runs/repairs unchanged. Pure-function paired runs preserve regression quality but do not show input reduction. Reuse approved seams; explicit-only spec orchestration does not automatically apply to every local change. |
| Independent review | [code-review](../../.agents/skills/code-review/SKILL.md), 6,559 characters, separates Standards and Spec assumptions and examines missing behavior as well as documented rules. [pr](../../.agents/skills/pr/SKILL.md), 4,107, asks for reviewable evidence and merge scope. | Two contexts add cost, but this adopted gate is not isolated in paired telemetry. Combining reviewers or replacing the body with a short checklist changes the guarantee. The original skips tooling-enforced findings, reducing duplicate review effort. |

Body sizes are static proxies. Quality benefits are requirements and source analysis; they are not claims of a measured reduction in defect rate or tokens.

## Alternatives

| Alternative | Benefit | Cost / authority | Decision |
| --- | --- | --- | --- |
| Preserve current originals/calls | One pinned source, aligned clients, traceable upstream updates, intact implementation/review guarantees. | Retains catalog/body overhead; optimum cost is unknown. | KEEP. Available evidence does not justify changing the method owner. |
| Clarify applicability in owned pointers | Avoids unnecessary reads/spec creation while preserving local versus broad work distinction. Integration already stages task, issue, and UI lookup. | Duplicated/broad pointers can shift cost to AGENTS/docs or alter invocation semantics. | Refine only for a specifically observed mis-trigger, preserving original frontmatter/calls. A conflicting invocation change requires a user decision under ADR-0011. |
| Propose upstream disclosure improvements | Improves the shared source for both clients without a competing local copy. | Requires behavior evidence, upstream review/acceptance, and upgrade; reference hops may offset shorter bodies. | Follow-up only when matched logs identify repeated low-value reads. This report authorizes no upstream publication. |
| Change local ownership/call/review policy | Could reduce body/catalog/reviewer overhead. | Conflicts with ADR-0011 original ownership/applicability/calls and independent Standards/Spec gate; forks multiply maintenance and can weaken quality. | No implementation. A separate proposal must name the ADR amendment, affected workloads, preserved guarantees and required explicit user decision. |

Before proposing a shorter body or a new disclosure boundary, compare total reads, calls, repairs, completion, and verification under the same workload. A summary copy or additional discovery stage can merely move cost. A new engine is outside the approved scope and is not supported by the present observations.

## Completion and validation

| Approved T11 criterion | Evidence / result |
| --- | --- |
| Separate repository instructions, catalog/called bodies, and external environment | Cost-owner table and T10 observation limits; exact delivered/source attribution remains unknown. |
| Compare small instruction edits, implementation, and independent review | Work-kind table; instruction-edit/review costs are explicitly static qualitative analysis, while implementation observations come from the paired runs. |
| Compare KEEP, applicability clarification, upstream proposal, and policy change | Alternatives table records benefits, costs, ADR conflict and required authority. |
| Avoid shortened copies or a new parallel procedure | One experimental report only; original bodies/calls/configs are untouched. |
| State ADR conflict and needed user decision; allow KEEP | ADR-0011 conflict is explicit for ownership/call/review changes; KEEP completes the policy decision without changing them. |
| Leave any change as a separately agreed proposal | Follow-up is conditional on observed mis-triggers or low-value reads; no policy change or upstream publication occurs. |

T10 retains all failed/retried/partial observations, cache and environment uncertainty, opaque first-edit context, nested-agent limits and verification differences. The aggregate evidence supports neither a blanket original-skill shortening nor a new engine. It also does not establish that the present originals are the optimal cost point. The justified decision is to preserve adopted guarantees while keeping unmeasured costs explicit.

This commit adds only an experimental Markdown report. It changes no product DOM, events, authentication, persistence or API paths; browser E2E is omitted for this report under the [local E2E criteria](../../docs/development/verification.md#로컬-e2e-실행-기준). The cumulative implementation judgment and final revision review/CI ownership remain in T10 and the linked spec/PR evidence. Validation: `node scripts/check-docs.mjs` passed for 678 text files; package script test component `node --test "scripts/*.test.mjs"` passed 70 with 1 skipped and 0 failed; `git diff --check` passed. An initial script-test attempt lacked worktree dependencies and failed before applicable checks; reusing the prepared node_modules via a temporary symlink recovered it without changing dependency or global configuration. Product tests or new test seams are not appropriate to this source-analysis report.

The [T10 report](results-2026-10-10.md) and [summary](results-2026-10-10.summary.json) own final aggregates, assessment, observer corrections and raw-file hashes. Raw events remain outside the repository at `/private/tmp/agent-efficiency-20261010/paired-runs/<run>/`. No new always-loaded pointer is added for this experiment.
