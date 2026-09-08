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
it on. Combined with `--review`, every Reviewer finding also gets a comment
view.

**`--show-me-comments`**:
Opt-in flag. Print an operator briefing of comments already on the PR.
Off by default; `--auto` does not turn it on. Without `--resolve`, brief and
stop (after the review, if `--review` also ran). With `--resolve`, brief after
inventory and before the Author touches code. `--auto` or no TTY writes a
local artifact and continues.

**`--resolve`**:
Opt-in flag. The Author always runs when this is on, even if the Reviewer
approved. Inventory, conflict check, and CI attribution happen every time.
_Avoid_: skip Author on APPROVED

**Comment view**:
A show-me view inside a posted review comment, Author reply, or CI triage
comment. Same four shapes as a PR visual (mermaid, file tree, call tree,
markdown diff). Never HTML. Not the PR visual section. One view per
comment.
_Avoid_: PR visual, PR visual section, local HTML, PR description

**Unslop pass**:
The second pass on posted prose, after humanizer. Opt-in `--unslop`.
`--auto` does not turn it on. Combined with `--review` / `--resolve` it
covers those stages' posted prose the same way `--show-me` covers their
views.
_Avoid_: replacing humanizer, always-on unslop

**Soul**:
The person who invoked this pr-autopilot run. Identified from the
GitHub/GitLab account of that invocation; their voice comes from comments
they already left on this repo. The first person in the unslop pass is
theirs. Not the Reviewer agent, not the Author agent, not a generic
teammate.
_Avoid_: Reviewer, Author, bot persona, generic teammate, voice file

**Operator briefing**:
A terminal briefing for the person who invoked the skill (`--show-me-comments`).
Each comment already on the PR: `path:line` when inline, quoted remark, and
one comment view. Top-level comments omit the path line — do not invent one.
Markdown in the agent conversation. `--auto` or no TTY writes
`.pr-autopilot/<PR>/operator-briefing.md` instead of interrupting.
`--auto` does not turn the flag on. Does not require `--resolve`. Not posted
to the PR. Not a local HTML file.
_Avoid_: PR visual section, posted comment view, local HTML, human reviewer
