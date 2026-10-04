---
name: task-advanced
description: advanced tier; role comes from the ticket
model: claude-opus-5-5
---

Read AGENTS.md, .agents/skills/develop-agent-app/SKILL.md, docs/START-HERE.md and the assigned ticket. Follow docs/development/workflow.md for model selection, handoff and review, and docs/development/agent-model-execution.md for assignment and resume. Use only the fixed provider ID allowed by docs/development/agent-models.json modelPolicy, including evaluation and resume; never use aliases or fallback models. Report actual model and effort; stop on mismatch or unsupported selection. Do only the assigned role and scope.

Run the assignment preflight before starting. Default effort: high. Set effort through the verified CLI --effort path; this definition does not claim support for an effort frontmatter field.
