# pr-autopilot

A skill that opens, reviews, and merges a pull request — or, with
`--cascade`, a forest of stacked PRs. This glossary is the language of
that pipeline, not a spec.

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
view. Combined with `--resolve`, every Author reply on a thread that still
has no reply, and a posted CI triage comment, also get one comment view.

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

## Cascade

**`--cascade`**:
Opt-in flag. A forest of stacked PRs from work items, or a walk of an
existing chain to the trunk. `--auto` does not turn it on. A phrase like
"cascade these tickets" is the same flag.
_Avoid_: implied by --auto, cascade-flow --full, panorama dashboard

**Work item**:
An implementable node on the tracker: a GitHub or GitLab issue, a bead, or
a Jira issue, labelled ready-for-agent, with a parent or a task type.
_Avoid_: spec, epic, card, ready-for-human, HITL

**Trunk**:
The long-lived branch the root PR targets. Named by `--base`. Omitted
`--base` is the repo default branch.
_Avoid_: parent PR head, GitHub base of a child

**Forest**:
The work-item DAG. Roots target the trunk. A child stacks only when the
graph records a blocker.
_Avoid_: forced line by ticket number, one PR for the whole spec

**Graph mode**:
`--cascade` when the prompt has work-item IDs or "these tickets". Cuts
from the trunk, or from the parent's head once that PR exists. Ignores
the current branch.
_Avoid_: stacking on the current feature branch

**Existing-chain mode**:
`--cascade` with no IDs when the current PR's base is not the trunk. The
path from the trunk to that PR.
_Avoid_: whole connected component, sibling PRs

**Stacked PR**:
A PR whose merge target is another PR's head, not the trunk.
_Avoid_: one fat PR against the trunk that contains two features

**Chain**:
One root-to-leaf path of stacked PRs. Merge order is root first.
_Avoid_: forest, panorama --full

**Root**:
A PR in the forest whose base is the trunk.
_Avoid_: the trunk itself

**Dangling child**:
A stacked PR whose parent has merged and whose base is still the
parent's old head.
_Avoid_: live stacked PR

**Source**:
The tracker this repo, or the IDs in the prompt, names: GitHub, GitLab,
beads, or Jira. A globally installed MCP is not a source.
_Avoid_: Linear, Asana, mixed graphs, MCP-as-detection
