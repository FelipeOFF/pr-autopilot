# pr-autopilot

A skill that opens, reviews, and merges a pull request. This glossary is the
language of that pipeline, not a spec.

## Language

**PR visual**:
The show-me views inside the PR visual section. Only what GitHub and GitLab
render: mermaid fences, file trees, call trees, markdown diffs. The agent
picks which views fit this PR. Not a local HTML file.
_Avoid_: estrutura da PR, pipeline diagram, local HTML preview, review-report

**PR visual section**:
The `## What this PR does` heading in the PR description. When `--show-me` is
on and the section opener is not already in the body, it is appended at the
end. When the opener matches, that heading block is replaced. It never
rewrites the rest of the body.
_Avoid_: insert-after-Summary, rewritten body, local HTML

**Section opener**:
The first sentence of the PR visual section. Fixed template, same on every
PR: `This briefing is for the reviewer: what the change does, the trade-off, and what we did not ship.` A regex on this sentence is how the pipeline
detects an existing section. Never humanized, never translated, never
paraphrased.
_Avoid_: HTML comment as the only detector, generated first sentence

**PR briefing**:
The prose in the PR visual section: what the change does, the trade-off, and
the alternative that did not ship, each backed by evidence. Not a pitch and
not a request to approve.
_Avoid_: defense, advocacy, "why this approach"

**PR description**:
The GitHub pull-request body or GitLab merge-request description. The only
surface a PR visual is published to.
_Avoid_: PR comment, local artifact, session transcript

**Human reviewer**:
A person on GitHub or GitLab deciding whether to approve the PR.
_Avoid_: Reviewer (that word already names the Reviewer agent in the pipeline)

**`--show-me`**:
Opt-in flag. Generate the PR visual section at create, and regenerate it after
an Author push that changed the diff. Off by default; `--auto` does not turn
it on.
