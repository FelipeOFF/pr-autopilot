---
name: pr-autopilot
description: Orchestrates the full lifecycle of a Pull Request — creation, two-track multi-agent code review (deep maintainability audit for code judo + test-value assessment when tests are present), triage of every comment already on the PR (human and bot), automated fixes with inline replies, merge-conflict resolution, CI failure attribution and repair, and auto-merge. Use when the user wants to ship a branch end-to-end with minimal supervision, or to work through the feedback and red CI a PR already has (e.g. "open PR and merge", "/pr-autopilot", "ship this branch", "resolve the PR comments", "fix the failing CI on my PR", "review and merge my branch"), or to cascade work items into PRs against the trunk ("cascade these tickets", "/pr-autopilot --cascade"). Supports GitHub (gh) and GitLab (glab). Coordinates Reviewer and Author subagents via the Task tool.
argument-hint: "[--auto] [--review] [--resolve] [--merge] [--show-me] [--show-me-comments] [--unslop] [--cascade] [--draft] [--max-iterations <N>] [--merge-strategy squash|merge|rebase] [--base <branch>] [--platform github|gitlab] [--ci-timeout <sec>] [--ci-poll-interval <sec>] [--title <text>] [--body <text>]"
---

# pr-autopilot

End-to-end PR pipeline: **create → (review → respond → re-review loop) → triage every comment on the PR → resolve conflicts & fix CI → wait for CI → merge**.

**Everything past PR creation is opt-in.** Every boolean flag defaults to `false`. With no flags the skill creates the PR and stops. You switch on each stage explicitly (`--review`, `--resolve`, `--merge`) or turn them all on at once with `--auto`.

**Phase 2 review runs two parallel tracks** when `--review` or `--auto` is set: (A) a **code track** that runs a deep maintainability audit for code judo, abstraction quality, file size, spaghetti growth, and structural simplification (the approval bar), and (B) a **test track** that evaluates tests in the PR diff by value and identifies removal candidates (tautologies, always-green, unjustified cost). Both tracks' findings are merged into one `review-report.md` and posted as one review on the PR. The test track only runs when the PR diff contains test files; otherwise it is skipped and only the code track runs.

This skill is **rigid**. When `--cascade` is on, run `plan` then `advance`
(§12) before Phase 1 on the current branch. Graph-mode **ship** is the
requested stages with host base = parent head or trunk. `--cascade` does
not turn `--merge` on. With `--merge` or `--auto`, `land` merges
bottom-up after the path is opened: the root into the trunk first, then
the next PR. Existing-chain walks ancestors plus current (not siblings)
and `land`s that path when merge was requested. A dangling child is
retargeted at the trunk even when `--merge` is off; the host merge
still needs `--merge` / `--auto`. When `--cascade` is off, follow the phases in
order from Phase 1. Do not skip the verification gates between phases.
Coordinate subagents via the `Task` tool (or `Agent` tool depending on
harness). Persist intermediate artifacts to `.pr-autopilot/<pr-number>/`
(and `.pr-autopilot/cascade/` under `--cascade`) so iterations and re-runs
are recoverable.

---

## 0. House style — humanize the prose, unslop the voice, ponytail the code, show-me the views

pr-autopilot produces three kinds of output (views split into the PR visual,
comment views, and the operator briefing), and each one has a skill that owns it.
This binds every agent in the pipeline: the orchestrator, the Reviewer, the Author,
and anything they spawn.

| Output | Owner skill | Applies to |
|--------|-------------|------------|
| Natural-language prose | `humanizer`, then `unslop` when `--unslop` is on | Generated title and body, review summary, every inline comment, every inline reply, the CI triage comment, the PR briefing after the section opener |
| Code | `ponytail` | Every fix the Author writes, every snippet the Reviewer suggests, conflict resolutions, CI repairs |
| PR visual views | `show-me` | Mermaid, file tree, call tree, markdown diff inside the PR visual section. Never HTML. |
| Comment views | `show-me` | Same four shapes, one per Reviewer finding when `--show-me --review`, one per Author reply and posted CI triage comment when `--show-me --resolve`. Never HTML. Not the PR visual section. |
| Operator briefing | `show-me` | Same four shapes, one per comment already on the PR when `--show-me-comments`. Harness-only markdown. Never posted. Never HTML. |

Invoke them with the `Skill` tool — `skill: "humanizer"`, `skill: "unslop"`,
`skill: "ponytail"`, `skill: "show-me"`. Some harnesses namespace ponytail as
`ponytail:ponytail`; try the plain name first and fall back. Under `--cascade`,
also load `cascade-flow` (§12.3). **If `humanizer` or
`ponytail` is not installed, the rules in §0.1 and §0.2 still bind.** The PR
visual section keeps the condensed `show-me` fallback in §3.4. **Comment views
and the operator briefing do not.** If `--show-me` or `--show-me-comments` is
on and `show-me` cannot load: print an alert that names `show-me` and the
install line `npx skills add FelipeOFF/skills --skill=show-me`, emit no HTML,
do not invent a comment view, skip the operator briefing (do not fake views),
and continue the rest of the pipeline (§4.3, §5.8, §3.7). Print that alert
once per run. **`unslop` is different:** when `--unslop` is on and the skill
cannot load, print the alert in §0.4 and do **not** fake the pass. Subagent
prompt templates (§4.5, §5.6) carry their own copy of house style — a subagent
is stateless and never reads this file. The orchestrator owns the PR visual
section and the operator briefing; Reviewer and Author do not write either.
The Reviewer prompt receives this run's `--show-me` bit so it can load
`show-me` for finding comment views. The Author prompt receives the same bit
so it can load `show-me` for replies and CI triage. The Author still must not
rewrite the PR description.

Local artifacts under `.pr-autopilot/` are the exception. They are machine state that
nobody reads on the PR, so their front-matter and `Action:` fields keep the flat
uppercase vocabulary (`FIXED`, `REFUTED`, `DEFERRED`, `SKIPPED`, `ANSWERED`). They
are never posted anywhere.

### 0.1 Prose is written by `humanizer`

Draft the text, run it through the `humanizer` skill, then through `unslop`
when `--unslop` is on this run (§0.4). Never post the raw draft. Humanizer
always runs first. Unslop does not replace it.

Without the skill, strip these yourself. They are what makes a comment read like a
bot wrote it:

- Status labels and emoji openers (`✅ FIXED`, `🛑 REFUTED`, `⏸ DEFERRED`) — see §0.3.
- Rule of three. "Cleaner, safer, and easier to maintain" is three adjectives doing the work of none.
- Em dash pile-ups. One per paragraph at most, and a comma usually does the job.
- Negative parallelism: "not just X, but Y", "this isn't about X, it's about Y".
- Promotional adjectives: robust, seamless, comprehensive, powerful, elegant. Say what the code does instead.
- AI vocabulary: leverage, delve, utilize, crucial, pivotal, underscore, ensure, streamline, holistic.
- Trailing `-ing` analysis: "…, ensuring maintainability and improving readability."
- Vague attribution: "best practice suggests", "it is generally recommended".
- Filler: "it's worth noting that", "in order to", "at this point in time".
- Generic closers: "Overall, this improves the quality of the codebase."
- Sycophancy as a formula: "Great catch!", "Excellent point!", "Thanks for the thoughtful review!" One short human acknowledgment is fine; a compliment sandwich is not.

Write the way a teammate writes on a PR. Short sentences. Name the file, the line and
the consequence. "is" and "are" are allowed. First person is allowed. No emoji unless
the repository already uses them in its own comments.

Do not humanize or unslop: code snippets, file paths, SHAs, command lines,
machine markers (`<!-- pr-autopilot:... -->`), the front-matter of local
artifacts, the section opener (the first sentence of the PR visual section —
exact template, bit-identical every run), mermaid fences, file trees, call
trees, or markdown diffs in the PR visual section, in a comment view, **or**
in the operator briefing. Rewrite the natural language between them. The PR
briefing (the sentences after the opener) is humanized, then unslopped when
the flag is on; the opener is not. Quoted remarks in the operator briefing
are the comment's own words — do not humanize, unslop, or paraphrase them.

### 0.2 Code is written by `ponytail`

Every line of code this pipeline writes or proposes goes through the ponytail ladder
first. Stop at the first rung that holds:

1. Does this need to exist at all? Speculative need means skip it, and say so in one line.
2. Does the codebase already have it — a helper, a util, a type, a pattern a few files over? Reuse beats rewrite.
3. Does the standard library do it?
4. Does a native platform feature cover it?
5. Does an already-installed dependency solve it? Never add a new one for what a few lines can do.
6. Can it be one line?
7. Only then: the minimum code that works.

No abstraction with a single caller, no config for a value that never changes, no
scaffolding for later. Deletion beats addition. Fix the root cause rather than the
symptom the comment happens to name: one guard in the shared function is a smaller
diff than a guard in every caller. Never propose a refactor larger than the finding
that triggered it.

Never be lazy about input validation at trust boundaries, error handling that
prevents data loss, security, accessibility, or anything a reviewer explicitly asked
for. And never lazy about understanding the problem — the ladder shortens the
solution, not the reading.

### 0.3 Say what happened, never stamp a status

No comment posted to the PR opens with `✅ FIXED`, `🛑 REFUTED`, `⏸ DEFERRED`,
`🤷 SKIPPED`, `💬 ANSWERED`, `[BLOCKER]`, or any other label of that shape. A form
stamp is the loudest signal that a machine wrote the comment.

The state those labels carried moves into an HTML comment on the last line of the
body. GitHub and GitLab both render it invisible, and it is what the orchestrator and
the next iteration parse:

```
<!-- pr-autopilot:action=fixed sha=abc1234 -->
```

**Author replies** — write the sentence, append the marker:

| Old stamp | Write something like | Marker |
|---|---|---|
| `✅ FIXED in abc1234` | Good catch. Swapped the header check for `session.isAdmin` in abc1234. | `<!-- pr-autopilot:action=fixed sha=abc1234 -->` |
| `🛑 REFUTED` | This one is already covered: `parseLimit` clamps to 100 on line 34, so the unbounded case never reaches here. | `<!-- pr-autopilot:action=refuted -->` |
| `⏸ DEFERRED` | Agreed, but it is a wider change than this PR should carry. Leaving it out so this one stays reviewable. | `<!-- pr-autopilot:action=deferred -->` |
| `🤷 SKIPPED` | Leaving this one alone. The rest of the file uses the same style, so changing it here makes it the odd one out. | `<!-- pr-autopilot:action=skipped -->` |
| `💬 ANSWERED` | It runs once per request, in the auth middleware, before the handler sees the body. | `<!-- pr-autopilot:action=answered -->` |

**Reviewer comments** — open with the words a reviewer says out loud, and put the
parseable severity in the marker:

| Severity | Opens with | Marker |
|---|---|---|
| BLOCKER | `Blocking:` | `<!-- pr-autopilot:severity=blocker -->` |
| SUGGESTION | `Suggestion:` (or just the sentence) | `<!-- pr-autopilot:severity=suggestion -->` |
| NITPICK | `nit:` | `<!-- pr-autopilot:severity=nitpick -->` |

Marker rules:

- Exactly one marker per posted comment, alone on the last line.
- A comment view (when present) sits in the body with the prose; the marker is still the last line.
- `action` is one of `fixed`, `refuted`, `deferred`, `skipped`, `answered`. `sha=` appears only on `fixed`.
- Never humanize, unslop, translate, reword or reformat a marker. It is not prose.
- The marker is what marks a thread handled on the next iteration. A reply without one gets re-answered forever.
- Replies left by older versions of this skill open with a status tag instead. Read those as handled too (§5.1).

### 0.4 Unslop pass (`--unslop`)

`--unslop` is a second pass on posted natural-language, after humanizer. It
does not replace humanizer. Default off. `--auto` does not turn it on. Parse
it like `--review`: the bare form means `true`; `--unslop=false` cancels it.

**Surfaces this run may write** go draft → humanizer → unslop:

- Generated PR title. An explicit `--title` override is left as written.
- Generated body, and a `--body` starting point: sentence prose only. Test
  plan checklists, paths, and backticks stay intact. Then `--show-me` apply
  still runs if that flag is on.
- Reviewer finding bodies and the top-level review summary
- Author replies
- A posted CI triage comment
- PR briefing prose after the section opener (when `--show-me` is on this run)

`--unslop` without `--review` does not invent a review. `--unslop` without
`--resolve` does not invent Author replies.

**Soul.** The first person in the unslop pass is the person who invoked this
run, not the Reviewer agent, not the Author agent, not a generic teammate.
Resolve the GitHub or GitLab account of this invocation and load a short
sample of comments that account already left on this repo. No sample → first
person, no invented voice file.

```bash
# GitHub
SOUL=$(gh api user --jq .login)
gh api "repos/$SLUG/issues/comments?per_page=50" \
  --jq "[.[] | select(.user.login==\"$SOUL\") | .body][0:8]"
gh api "repos/$SLUG/pulls/comments?per_page=50" \
  --jq "[.[] | select(.user.login==\"$SOUL\") | .body][0:8]"

# GitLab
SOUL=$(glab api user | jq -r .username)
# notes this account already left on this project (walk recent MR discussions)
glab api "projects/:id/merge_requests?state=all&per_page=10" \
  | jq -r '.[].iid' \
  | while read -r iid; do
      glab api "projects/:id/merge_requests/$iid/notes" \
        | jq -r --arg u "$SOUL" '.[] | select(.author.username==$u) | .body'
    done | head -8
```

Do this once in Phase 1 when `--unslop` is on. Pass `SOUL` and the sample (or
`no sample — first person, no invented voice`) into the Reviewer and Author
prompts — they are stateless and will not read this file.

**Exemptions — never humanize or unslop:** the section opener, markers,
mermaid fences, file trees, call trees, markdown diffs, file paths, SHAs,
command lines, and local artifact front-matter. Marker stays alone on the
last line of a finding, reply, or CI triage comment.

**Missing skill.** If `--unslop` is on and the `unslop` skill cannot load,
print an alert that names the skill and the install line, then continue.
Do **not** silently apply a condensed fake of the pass. Posted prose stays
humanizer-only. Humanizer and ponytail keep their in-skill condensed
fallbacks (§0.1, §0.2).

```
[unslop] skill missing — install with:
npx skills add https://github.com/cursor/plugins --skill=unslop
```

Load `unslop` (`Skill` tool, `skill: "unslop"`) once in Phase 1 when the
flag is on. Record `unslop` in run state from this invocation only
(§3.2, §3.5) — do not inherit `true` from an older run.

**`posted(kind, draft, flags) → markdown`** — the seam for posted text.
`kind` is one of `title`, `body`, `finding`, `reply`, `ci-triage`. Done
means the examples below hold.

```
on(posted)
  if kind == title and --title was passed
    return draft unchanged
  prose = humanizer(draft)            # skip exempt spans
  if --unslop
    if unslop skill loaded
      prose = unslop(prose, soul)     # skip exempt spans
    else
      alert + npx install line
      # prose stays humanizer-only; do not fake unslop
  if kind in {finding, reply, ci-triage}
    if --show-me and show-me skill loaded this run
      if kind == finding and --review
        view = exactly one of {mermaid, file tree, call tree, markdown diff}
      else if kind in {reply, ci-triage} and --resolve
        view = exactly one of {mermaid, file tree, call tree, markdown diff}
      else
        view = none
    else
      view = none
    return prose + (blank line + view if any) + marker alone on last line
    # --show-me on and skill missing: same alert as §4.3 / §5.8; do not invent
    # a view; post prose + marker; pipeline continues. Never HTML.
    # if a draft carries more than one view, keep the first, drop the rest
  return prose
```

**Examples (completion criterion for posted):**

1. `--unslop` only, generated body, no opener → body is humanized then unslopped; no PR visual section.
2. `--unslop --review` → each finding body is humanized then unslopped; marker is the last line.
3. `--unslop --resolve` → each Author reply is humanized then unslopped; marker is the last line.
4. `--unslop` and a posted CI triage comment → that prose is humanized then unslopped; marker is the last line.
5. `--auto` without `--unslop` → no unslop on any surface.
6. `--auto --unslop` → unslop on every posted prose surface `--auto` already writes.
7. `--unslop` set and unslop skill missing → alert + npx install line; body still posted via humanizer only; no fake unslop.
8. `--title` override + `--unslop` → title unchanged; generated body still unslopped.
9. `--unslop` without `--review` → no review is generated.
10. `--body` + `--unslop` → starting body humanized then unslopped on sentence prose; Test plan checklists, paths, and backticks intact; `--show-me` apply still runs if that flag is on.
11. Section opener, markers, fences, trees, diffs, paths, SHAs, and command lines are bit-identical to the draft; marker remains the last line of a finding, reply, or CI triage comment.
12. `--show-me --resolve` and show-me loaded, kind=`reply` → humanized (then unslopped if `--unslop`) + exactly one of the four views + marker last line (§5.8).
13. `--resolve` without `--show-me`, kind=`reply` → prose + marker, no view.
14. `--show-me --resolve` and show-me loaded, kind=`ci-triage` → exactly one view; `<!-- pr-autopilot:ci-triage:<check-name> -->` last line.
15. `--show-me` on, skill missing, kind=`reply` or `ci-triage` → alert + npx; posted without view, no HTML.
16. `--review --resolve --show-me --unslop`, skill present → PR visual section + one comment view on each finding and unreplied reply (and a posted CI triage comment) + unslop on that posted prose. One `posted()` call per surface; do not run humanizer twice.

---

## 1. Flags / Parameters

Parse these from the user's invocation. **Everything is opt-in: every boolean flag
defaults to `false`.** With no flags, `pr-autopilot` creates the PR and stops. You
turn on each stage explicitly (`--review`, `--resolve`, `--merge`) or turn them all
on at once with `--auto`.

### Mode flags (compose them; each stage is opt-in)

| Mode | Flags | Pipeline |
|------|-------|----------|
| **PR only** *(default, no flags)* | *(none)* | Phase 1 → STOP. Create the PR, print the URL, exit. Nothing else runs. |
| **PR + merge** | `--merge` | Phase 1 → Phase 5 (CI) → Phase 6 (merge). No review. |
| **PR + review** | `--review` | Phase 1 → Phase 2 (Reviewer posts inline comments) → STOP. |
| **Resolve what's already there** | `--resolve` | Phase 1 → **Phase 3** (`Trigger=pr-feedback`): the Author triages every comment already on the PR — human or bot — resolves conflicts and fixes CI → Phase 5 → STOP before merge. **No new AI review is posted.** |
| **Review + resolve** | `--review --resolve` | Phase 1 → Phase 2 → Phase 3 (always, even on APPROVED) → loop → STOP before merge. Add `--merge` to merge on green CI. |
| **Auto (full hands-off)** | `--auto` | Everything on: review + resolve + wait ALL CI + merge, no prompts. Resolves merge conflicts and fixes failing CI along the way. Halts or escalates only on a guardrail it must not cross. Does **not** turn on `--cascade`. |
| **Cascade** | `--cascade` | `plan` then `advance` (§12). IDs → graph (forest, host base = parent head or trunk). An open work-item PR is reused (restacked if the base is wrong). A failed ship stops the forest. No IDs and current PR base ≠ trunk → existing-chain (path to this PR). `--cascade` does not turn `--merge` on. With `--merge` or `--auto`, `land` merges bottom-up (root into the trunk first). `--auto` does not turn this on. A phrase like "cascade these tickets" does. |

Rules that tie the flags together:

- `--resolve` is **independent of** `--review`. On its own it runs the Author against the feedback the PR already has — teammates' comments, Copilot/CodeRabbit/Sonar findings, merge conflicts, red CI — without posting a review of its own. That is the mode for a PR a human already reviewed.
- With `--resolve` or `--auto`, Phase 3 **always** runs after Phase 2, including when `verdict: APPROVED` and `blocker_count: 0`. That Author round still inventories comments already on the PR, checks conflicts, and attributes CI. `--review` without `--resolve` still stops after Phase 2.
- `--review --resolve` (and `--auto`) reviews first, then the Author resolves that review *plus* everything else already on the PR — and still runs when the Reviewer approved.
- `--merge` is what enables the merge. Without it (and without `--auto`), the pipeline always stops before merging, no matter how green CI is.
- `--auto` is shorthand for `--review --resolve --merge` plus a "never prompt for confirmation" semantic **and** the aggressive-resolution behavior: in `--auto` (and any `--resolve`) run, the Author resolves merge conflicts and fixes failing CI, not just review comments.
- `--auto` does **not** turn on `--show-me`, `--unslop`, `--show-me-comments`, or `--cascade`.
  The PR visual section, comment views, and the operator briefing are separate
  opt-ins. `--show-me` without `--review` still only means the PR visual
  section (existing behavior), not a new review — unless `--resolve` is also
  on, in which case unreplied replies and a posted CI triage comment each get
  one comment view. `--show-me-comments` without `--resolve` briefs and stops
  (after the review, if `--review` also ran) on a **single-PR** run. Under
  `--cascade` graph, brief that PR's comments and continue to the next
  work item — do not abort the forest. A phrase like "cascade these
  tickets" (or equivalent) sets `--cascade`. cascade-flow `--full` does not.
- `--cascade` does **not** turn on `--merge`. Flags already on this run (`--review`, `--show-me`, `--show-me-comments`, `--unslop`, `--draft`, `--resolve`, `--merge`, `--auto`) compose onto each shipped PR (graph) or the current PR only (existing-chain). Merge is the exception: with `--merge` or `--auto`, `land` walks the path bottom-up — graph: root into the trunk before the child; existing-chain: ancestors plus current, not siblings. `--draft` still forbids merge. A standing human `CHANGES_REQUESTED` still blocks merge of that PR.
- Under `--cascade`, `--base` is the **trunk** the root PR targets (repo default if omitted). It is not this PR's parent.
- `--draft` forces no merge even when `--merge`/`--auto` is set.
- **No prompts means no consent.** Anything that needs the developer's explicit yes — a business-rule change (`groom-me`), or a comment claiming CI is red for reasons outside the PR — is never done silently in `--auto` or in a non-interactive run. It is recorded as `escalated` instead.

`--auto` does **not** weaken any guardrail: a fix that regresses tests, a conflict
that touches business logic, an unresolved BLOCKER, or a still-red required check
all halt or escalate. The merge step only executes when Phase 5 reports every
required check green AND the PR is `MERGEABLE`.

### All flags

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | `false` | Full hands-off. Turns on `--review`, `--resolve`, `--merge`, disables prompts, and lets the Author resolve conflicts + fix CI. Does **not** turn on `--show-me` or `--cascade`. |
| `--review` | `false` | Run the Reviewer subagent (inline comments). |
| `--resolve` | `false` | Run the Author subagent — always, even when the Reviewer approved. Triages every comment already on the PR (human and bot), addresses the actionable ones, checks (and resolves) merge conflicts, attributes CI and fixes a failure this PR caused. Does **not** imply `--review`; combine them to also post a fresh review first. |
| `--merge` | `false` | Enable auto-merge once every required check is green and the PR is `MERGEABLE`. Without it (or `--auto`) the pipeline stops before merge. `--cascade` does not turn this on. |
| `--max-iterations` | `2` | Max review→respond (and CI-fix) cycles before escalating to the user. |
| `--merge-strategy` | `squash` | One of `squash`, `merge`, `rebase`. |
| `--base` | auto-detect | Target branch. Defaults to repo default branch (`main`/`master`/`trunk`). Under `--cascade`, this is the **trunk** the root PR targets, not a child's parent. |
| `--draft` | `false` | Open PR as draft. Forces no merge. Composes onto a cascade ship when passed. |
| `--platform` | auto-detect | `github` or `gitlab`. Auto-detected from remote URL. |
| `--ci-timeout` | `1800` | Seconds to wait for checks before bailing. |
| `--ci-poll-interval` | `30` | Seconds between status polls. Backs off to 60s after 10 polls. |
| `--title` | auto-generated | Override generated title. Ignored in cascade graph mode (§12.2). In existing-chain mode, applies to the current PR only. |
| `--body` | auto-generated | Override generated body. Starting point for `--show-me` apply; the flag still appends or replaces the PR visual section. Sentence prose still goes through `posted` (§0.4). Ignored in cascade graph mode (§12.2). In existing-chain mode, applies to the current PR only. |
| `--show-me` | `false` | Append (or replace) a PR visual section on the PR description so a human reviewer can read what the change does before the diff. Combined with `--review`, every Reviewer finding also gets one comment view (mermaid / file tree / call tree / markdown diff, never HTML) on the same line as the finding. Combined with `--resolve`, every Author reply on a thread that still has no reply, and a posted CI triage comment, also get exactly one comment view. Marker stays last. Not implied by `--auto`. Composes onto a cascade ship when passed. |
| `--show-me-comments` | `false` | Print an operator briefing of comments already on the PR: `path:line` when inline, quoted remark, one comment view. Harness-only markdown. Never posted. Never HTML. Not implied by `--auto`. See §3.7. Composes onto a cascade ship when passed. Without `--resolve`, a single-PR run briefs and STOPs; under `--cascade` graph, brief that PR and continue. |
| `--unslop` | `false` | After humanizer, run posted prose through `unslop` in the invoker's soul (§0.4). Not implied by `--auto`. |
| `--cascade` | `false` | Opt-in. `plan` then `advance` (§12). IDs or "these tickets": graph mode, a forest. An open work-item PR is reused (restacked if the base is wrong). A failed ship stops the forest. No IDs and current PR base ≠ trunk: existing-chain, the path from the trunk to this PR; siblings stay off the path. Does not turn `--merge` on. With `--merge` or `--auto`, `land` merges bottom-up. Not implied by `--auto`. A phrase like "cascade these tickets" sets it. |

Boolean flags accept a bare form (`--review`, `--unslop`, `--show-me`,
`--show-me-comments`, `--cascade`) or an explicit value (`--review=true` /
`--review=false`, `--unslop=true` / `--unslop=false`, `--show-me-comments=true` /
`--show-me-comments=false`, `--cascade=true` / `--cascade=false`). The bare form
means `true`. An explicit `--review=false` is only useful to cancel a flag that
`--auto` would otherwise turn on (e.g. `--auto --merge=false` → do everything but
stop before merge). `--unslop=false`, `--show-me-comments=false`, and
`--cascade=false` are the same parse; `--auto` does not turn those on, so the
explicit false is rarely needed. `--cascade=false` cancels a cascade phrase.

### Invocation flow (decision tree)

```
pr-autopilot
   │
   ├─ --cascade (or a cascade phrase)
   │                    ► plan then advance (§12)
   │                      IDs → graph: each ship = one of the branches below
   │                      no IDs, current PR base ≠ trunk → existing-chain
   │                      host base = parent head or trunk
   │                      reuse open work-item PR; halt forest on failure
   │                      --cascade does not turn merge on
   │                      --merge / --auto → land bottom-up after the path
   │                      --auto does not take this branch
   │
   ├─ --auto ───────────► full hands-off: PR → review → resolve
   │                        (comments + conflicts + CI) → wait ALL CI → merge
   │
   ├─ (no flags) ───────► PR only: create the PR and STOP
   │
   ├─ --merge ──────────► PR → wait CI → merge (no review)
   │
   ├─ --review ─────────► PR → inline review → STOP (human resolves)
   │
   ├─ --resolve ────────► PR → Author triages the comments ALREADY on the PR
   │                        (human + bot) + conflicts + CI → wait CI
   │                        → STOP before merge. No new review posted.
   │
   └─ --review --resolve ► PR → inline review → Author always runs
                            (even if APPROVED) on that review AND everything
                            else on the PR → STOP before merge
                            (add --merge to merge on green CI)
```

Invocation examples:
- `pr-autopilot` → create the PR and stop
- `pr-autopilot --merge` → create PR + auto-merge on green CI (no review)
- `pr-autopilot --review` → create PR, post inline review, stop
- `pr-autopilot --resolve` → Author works the feedback the PR already has (no new review), stop before merge
- `pr-autopilot --review --resolve` → post a review, then Author runs even if APPROVED
- `pr-autopilot --resolve --merge` → resolve existing feedback + merge on green CI
- `pr-autopilot --auto` → full hands-off; merges only when CI is green
- `pr-autopilot --auto --merge-strategy=rebase --max-iterations=3`
- `pr-autopilot --show-me` → create the PR with a PR visual section, then stop
- `pr-autopilot --show-me --review` → PR visual section **and** one comment view on each Reviewer finding
- `pr-autopilot --show-me --resolve` → section on create; one comment view on each unreplied reply and on a posted CI triage comment; regenerate the section after an Author push that changed the diff
- `pr-autopilot --auto --show-me` → full hands-off **and** the section (still not implied by `--auto` alone); because `--auto` already turns on `--review` and `--resolve`, findings, unreplied replies, and a posted CI triage comment get comment views too
- `pr-autopilot --show-me-comments` → fetch comments already on the PR, print an operator briefing, STOP. No Author. No new posts
- `pr-autopilot --show-me-comments --review` → Phase 2 posts the review, then brief (including those findings), STOP
- `pr-autopilot --show-me-comments --resolve` → brief after inventory, then Author addresses findings
- `pr-autopilot --auto --show-me-comments` → write `.pr-autopilot/<PR>/operator-briefing.md`, do not interrupt, continue `--auto`
- `pr-autopilot --unslop` → create the PR; generated title and body are humanized then unslopped
- `pr-autopilot --unslop --review` → each Reviewer finding body is humanized then unslopped
- `pr-autopilot --unslop --resolve` → each Author reply (and a posted CI triage comment) is humanized then unslopped
- `pr-autopilot --auto --unslop` → full hands-off **and** unslop on every posted prose surface `--auto` already writes
- `pr-autopilot --cascade` → plan/advance. IDs: a forest (reuse open PRs; halt on failure). No IDs and current PR base ≠ trunk: existing-chain (path to this PR; siblings off the path). Does not merge
- `pr-autopilot --cascade --merge` → same path, then `land` bottom-up: root into the trunk first; child retargeted if it still pointed at the old head
- `pr-autopilot --cascade --auto` → review/resolve/CI per item as today, then `land` bottom-up. `--auto` still does not turn `--cascade` on
- `pr-autopilot --cascade --draft --merge` → PRs may open as draft; none merge
- `pr-autopilot --cascade --review --show-me --show-me-comments --draft` → those flags compose onto each shipped PR (graph) or the current PR only (existing-chain); still no merge. `--show-me-comments` without `--resolve` briefs each graph ship and continues; it does not STOP the forest
- "cascade these tickets" → same as `--cascade` (and graph mode: "these tickets")
- `pr-autopilot --cascade PROJ-12` → Jira source, graph mode, no question
- `pr-autopilot --cascade #9` → GitHub source (origin GitHub), graph mode, no question

If no flags are present and the invocation is interactive, the orchestrator MAY
prompt once: "Which mode? [1] PR only (default)  [2] PR + merge  [3] PR + review
[4] Resolve what's already on the PR  [5] Review + resolve  [6] Auto (full
hands-off)". In non-interactive mode with no flags, default to mode 1 (PR only) —
create the PR and stop.

---

## 2. Architecture

When `--cascade` is on, this diagram is one graph-mode **ship**.
`plan` / `advance` (§12) wrap it. Host base is the parent head or the
trunk. The current feature branch is not the parent. Existing-chain
does not cut a ship; it walks the current PR. Phase 6 on a cascade run
is `land` (§12.2): bottom-up, never during a child's ship into a still-open
parent. When `--cascade` is off, start here on the current branch.

```
┌─────────────────────────────────────────────────────────────────┐
│                      pr-autopilot (orchestrator)                │
│                                                                 │
│  Phase 1: Preflight + PR Creation                               │
│      │                                                          │
│      ▼                                                          │
│  Phase 2: Two parallel tracks (skipped when --resolve w/o       │
│      │    --review):                                            │
│      │    A) Code track (Task)  ──► review-report.md            │
│      │    B) Test track (2 ranker Tasks + 1 consolidator) ──►   │
│      │       test-ranker-a.md, test-ranker-b.md,                │
│      │       test-consolidated.md                               │
│      │    Orchestrator merges findings → posts one review       │
│      ▼                                                          │
│  Phase 3: Author subagent (Task)    ──► pr-feedback.md          │
│      │     ALWAYS when --resolve/--auto, including APPROVED     │
│      │     triages EVERY comment on the PR — human and bot ──►  │
│      │     fixes them, checks merge conflicts,     response-    │
│      │     attributes CI (never patches external), summary.md   │
│      │     commits, pushes                                      │
│      │     (business rules → groom-me; CI that isn't the PR's   │
│      │      fault → ask the dev before commenting)              │
│      ▼                                                          │
│  Phase 4: Loop guard                                            │
│      │   if Reviewer not APPROVED and iter < max → back to P2   │
│      │   if iter == max → escalate to user                      │
│      ▼                                                          │
│  Phase 5: CI polling (gh/glab)                                  │
│      │   if a check fails and --resolve is on → back to P3      │
│      │   (Author fixes CI), else surface logs and stop          │
│      ▼                                                          │
│  Phase 6: Auto-merge (only when --merge or --auto)              │
└─────────────────────────────────────────────────────────────────┘
```

**Subagents are stateless.** Each invocation gets a self-contained prompt with: PR number, diff, base ref, and the path to the artifact it must write. Never delegate "understanding" — the orchestrator reads each artifact and decides next phase.

Because they are stateless, every subagent prompt carries its own copy of the house
style (§0) **and this run's `--unslop` bit**: the Reviewer and the Author each
invoke `humanizer` for prose, then `unslop` when the flag is on, and `ponytail`
for code. Humanizer and ponytail keep their condensed fallbacks when missing;
unslop does not — missing unslop with the flag on is the alert in §0.4. The
Reviewer prompt also receives this run's `--show-me` bit. When it is on, the
Reviewer loads `show-me` for finding comment views (§4.3). The Author prompt
receives the same bit. When it is on, the Author loads `show-me` for replies
and CI triage only (§5.8). The Author still must not edit the PR description.
The orchestrator owns the operator briefing (§3.7) — no new subagent. The
Author does not write it.

Phase 3 only runs under `--resolve`/`--auto`, and when those flags are on it
**always** runs after Phase 2 — including when the Reviewer verdict is APPROVED.
Do not jump to Phase 5 on APPROVED: that skips inventory, the conflict check, and
CI attribution. When Phase 3 runs, the Author's job is the whole PR: it triages
every comment already on it (teammates, Copilot, CodeRabbit, Sonar — inline and
top-level), checks merge conflicts, and attributes CI (fixing a failure this PR
caused; never patching around external CI). It escalates to the user (via the
`groom-me` skill) whenever a change would touch a business rule, and asks before
claiming on the PR that a red check is someone else's problem. Phase 2 is skipped
entirely when `--resolve` runs without `--review`. Phase 6 only runs under
`--merge`/`--auto`.

---

## 3. Phase 1 — Preflight + PR Creation

If `--cascade` is on **this invocation**, go to **§12** first. Do not
push the current branch as a graph-mode PR head. Each graph-mode
**ship** re-enters this phase on the work-item branch with `BASE` =
parent head or trunk. A **reuse** does not cut a new branch: it
enters **§3.2** on the existing PR (restack first if the base is
wrong, §12.2). Existing-chain does not cut a new branch; the
current PR is already the end of the path. Phase 6 on a cascade
run is `land` (§12.2), not a per-ship merge into a still-open parent.

### 3.1 Preflight (fail fast)

Run these checks before anything else. Abort with a clear message on failure.

```bash
# Inside a git repo?
git rev-parse --is-inside-work-tree

# Current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Skip this abort in --cascade graph mode until ship has cut a work-item
# branch from trunk or the parent head (§12.2). Graph mode never uses the
# current branch as the PR head. After that cut, the abort still applies
# if BRANCH is main/master.
[ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ] && echo "ABORT: on protected branch" && exit 1

# Working tree clean?
[ -z "$(git status --porcelain)" ] || echo "WARN: uncommitted changes — ask user to commit first"

# Remote + platform detection
REMOTE_URL=$(git remote get-url origin)
case "$REMOTE_URL" in
  *github.com*)  PLATFORM=github ;;
  *gitlab*)      PLATFORM=gitlab ;;
  *)             echo "ABORT: unsupported remote" && exit 1 ;;
esac

# CLI present?
[ "$PLATFORM" = "github" ] && command -v gh   >/dev/null || echo "ABORT: gh CLI missing"
[ "$PLATFORM" = "gitlab" ] && command -v glab >/dev/null || echo "ABORT: glab CLI missing"

# Push branch if not on remote
git push -u origin "$BRANCH" 2>/dev/null || git push origin "$BRANCH"
```

When `--unslop` is on, load `unslop` (`Skill` tool, `skill: "unslop"`) and
resolve soul (§0.4). If the skill cannot load, print the alert and continue
humanizer-only. Record `unslop` from **this invocation** in `state.json` later
(§3.2 / §3.5) — do not inherit `true`.

When `--show-me` or `--show-me-comments` is on, load `show-me` (`Skill` tool,
`skill: "show-me"`). If it cannot load, print the alert in §3.4 / §3.7 once
this run. Record `show_me` and `show_me_comments` from **this invocation**
later in `state.json` — do not inherit `true`.

### 3.2 PR existence check

If a PR already exists for this branch, **reuse it**. Do not error out — that's a
normal re-run.

```bash
# GitHub
gh pr view --json number,url,state,body -q '{number,url,state,body}' 2>/dev/null

# GitLab
glab mr list --source-branch "$BRANCH" --output json | jq '.[0].iid'
# then: glab mr view <iid>  (description is the body)
```

Capture `PR_NUMBER` and `PR_URL`. Then:

- If `--show-me` is on, fetch the live description and run **§3.4** (apply +
  update the existing PR/MR). Do not skip this because create was skipped.
  GitHub: the `body` field from `gh pr view --json`. GitLab:
  `glab mr view <iid> --output json` → `.description`.
- Write or update `.pr-autopilot/<PR_NUMBER>/state.json`. Set
  `show_me` to whether `--show-me` is on **this invocation** (do not inherit
  `true` from a previous run). Set `show_me_comments` the same way from
  `--show-me-comments` — do not inherit `true`. Set `unslop` the same way
  from `--unslop` — do not inherit `true`. Set `cascade` the same way from
  `--cascade` — do not inherit `true`. Set `head_sha` to HEAD. Preserve
  an existing `iteration` if present; do not reset it to 0.
- Then jump to **§3.6** with that PR number. Do not generate a new title/body.

### 3.3 Title + body generation

If `--title`/`--body` not provided:

1. Read commits on the branch: `git log --no-merges <base>..HEAD --pretty=format:'%s%n%n%b'`
2. Read the diff stat: `git diff <base>...HEAD --stat`
3. Read the full diff (truncate to 200KB if larger): `git diff <base>...HEAD`
4. Generate a title following the user's commit convention (Conventional Commits + Jira: `type(JIRA-XXX): Sentence-case title`). Pull Jira from branch name if present (`feat/JIRA-222/...` → `JIRA-222`).
5. Generate body with three sections:

```markdown
## Summary
<1–3 bullets, why this exists>

## Changes
- <bullet per logical change, grouped, file paths in backticks>

## Test plan
- [ ] <concrete checks the reviewer can run>
```

6. **Run `posted` on the title and body before creating the PR** (§0.4).
   - Generated title: `TITLE = posted(title, draft, flags)` — humanizer, then
     unslop if `--unslop`. An explicit `--title` override is left as written.
   - Generated body: pass the Summary + Changes **sentence prose** through
     `posted(body, …)`. Leave the `## Test plan` checklist, file paths, and
     backticked identifiers intact.

If `--body` was provided, that string is the starting body (no Summary/Changes
generation). Run `posted(body, …)` on its sentence prose the same way; Test
plan checklists, paths, and backticks stay intact. `--title` only overrides
the title; the body still follows this section (generated or `--body`).

When this create is a cascade graph-mode **ship** (§12.2), ignore `--title`
and `--body`. Generate both from the work item. The body must close the
work item (GitHub/GitLab: `Closes #<id>`; Jira: the issue key in
title/body; beads: the bead id) and must not close the parent spec. A
child body also includes `Stacked on: #<parent> (merge after)`.
In existing-chain mode, `--title` / `--body` apply to the current PR
only — same as a non-cascade run. Do not stamp them on ancestors.

If `--show-me` is on, run **§3.4** on this body **after** `posted` and
**before** create, so the PR opens with the PR visual section already applied.

### 3.4 PR visual section (`--show-me`)

The orchestrator owns this. No new subagent. Reviewer and Author do not write
it. Skip the whole section when `--show-me` is off.

**Section opener** (fixed template, never humanized, never unslopped, never
translated, never paraphrased — a regex on this sentence is how the next run
finds the section):

```
This briefing is for the reviewer: what the change does, the trade-off, and what we did not ship.
```

**Section shape:**

```markdown
## What this PR does

This briefing is for the reviewer: what the change does, the trade-off, and what we did not ship.

<at most two show-me views: mermaid, file tree, call tree, or markdown diff>

<PR briefing: what the change does, the trade-off, the alternative that did not
ship, each with evidence. About eight sentences. Not a pitch. Not a request to
approve.>
```

**Generate the section**

1. Read `git diff <BASE>...<BRANCH>` (same cap as §3.3).
2. Load `show-me` (`Skill` tool, `skill: "show-me"`). Ask it for the smallest
   views that explain *this* change to a human reviewer, from {mermaid, file
   tree, call tree, markdown diff}, **at most two**. Never HTML — GitHub and
   GitLab will not render it in the description.
3. If `show-me` is missing, print an alert once this run that names `show-me`
   and the install line `npx skills add FelipeOFF/skills --skill=show-me`. Then,
   for the **PR visual section only**, do the same by hand: pick at most two of
   those views. A one-line config change gets a small view, not a sequence
   diagram. A large diff gets the slice the reviewer needs, not a map of the
   repo. Never skip the PR visual silently. Never emit HTML. Do **not** use
   this fallback to invent **comment views** (§4.3, §5.8) or an **operator
   briefing** (§3.7) — those stay omitted when the skill is missing. Format:
   - mermaid → a fenced block with language `mermaid` (flowchart or sequence)
   - file tree → indented tree; every path in backticks
   - call tree → indented calls; paths in backticks
   - markdown diff → a fenced block with language `diff`
   File paths in every view go in backticks, same as the Changes list.
4. Write the PR briefing (after the opener). Evidence, not adjectives.
5. Run `posted` on the briefing prose only (§0.4): humanizer, then unslop
   if `--unslop` is on this run. Leave the opener, heading, fences, trees,
   and paths untouched.
6. Assemble the section in the shape above.

**`apply(body, section) → body`** — this is the seam. Done means the eight
examples below hold.

```
on(apply)
  if body matches section opener (exact sentence)
    replace the heading block
      start: the ## What this PR does that precedes the opener with only
             blank lines in between (the template has one blank line under
             the heading). Else the opener line.
      end: next ## heading or EOF
    return body
  append section at end
    if body is non-empty and does not already end in a blank line, insert a separating newline
    return body
```

A human-written `## What this PR does` **without** the opener is not a match.
Leave it. Append the pipeline section at the end.

Never splice after `## Summary`. That heading may not exist.

**Examples (completion criterion for apply):**

1. Empty body → body equals the section.
2. Default Summary / Changes / Test plan, no opener → section appended after Test plan; those three headings unchanged.
3. Custom `--body` with no `## Summary` and no opener → section appended; custom prose unchanged.
4. Body already contains heading + opener + old views → that block replaced; text before the heading unchanged; a later `##` heading unchanged.
5. Body contains the opener without the heading → replace from the opener line through the next `##` or EOF.
6. Body contains `## What this PR does` *without* the opener (human-written) → that heading left alone; pipeline section appended at the end.
7. Apply twice with the same opener → still one section (second call is a replace).
8. Body ending without a trailing newline → append still inserts a separating blank line before the heading.

**Publish**

- New PR: set `BODY = apply(BODY, section)`, then create with that body (§3.5).
- Existing PR: fetch the live description, `BODY = apply(BODY, section)`, then:

```bash
# GitHub
gh pr edit <PR_NUMBER> --body "$BODY"

# GitLab
glab mr update <PR_NUMBER> --description "$BODY"
```

Write the applied section to
`.pr-autopilot/<PR_NUMBER>/pr-visual.md` every time apply runs.

Print one terminal line: `PR visual section appended` or
`PR visual section replaced`.

Persist `show_me: true` and `head_sha: <HEAD>` in `state.json` so a later
Author round can regenerate without re-parsing the prompt. Leave `unslop`
and `show_me_comments` as already set from this invocation (§3.2 / §3.5).

### 3.5 Create PR

```bash
# GitHub
gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" --body "$BODY" \
  $([ "$DRAFT" = "true" ] && echo "--draft")

# GitLab
glab mr create --source-branch "$BRANCH" --target-branch "$BASE" \
  --title "$TITLE" --description "$BODY" \
  $([ "$DRAFT" = "true" ] && echo "--draft")
```

Capture and persist:
- `PR_NUMBER`
- `PR_URL`
- Initialize `.pr-autopilot/<PR_NUMBER>/state.json` with
  `{iteration: 0, status: "created", show_me: <bool>, show_me_comments: <bool>, unslop: <bool>, cascade: <bool>, head_sha: "<HEAD>"}`
  `show_me`, `show_me_comments`, `unslop`, and `cascade` are whether those flags
  are on **this invocation** (do not inherit `true` from a previous run).

### 3.6 Post-creation routing

Route by the flags that are on (`--auto` implies `--review`, `--resolve` and
`--merge`; it does **not** imply `--show-me-comments`):

- **`--show-me-comments` without `--review` and without `--resolve`** (and
  without `--auto`) → run **§3.7**, then STOP. Print the PR URL and exit.
  No Author. No new posts. `--merge` does not override this stop.
  Under `--cascade` graph, brief that PR and return to `advance` — do
  not STOP the forest.
- **No `--review`, `--resolve`, `--merge` or `--auto`** (and no
  `--show-me-comments`) → STOP here. Print the PR URL and exit. This is the
  default "PR only" mode.
- **`--review`** (with or without `--resolve`) → go to **Phase 2**.
  `--show-me-comments --review` without `--resolve` briefs after the review
  is posted (§4.7), then STOP.
- **`--resolve` without `--review`** → skip Phase 2 entirely and go straight to
  **Phase 3** with `Trigger=pr-feedback`. There is no `review-report.md` this run;
  the Author's findings come from the PR's own comments (§5.1). If
  `--show-me-comments` is also on, brief after inventory and before code
  (§3.7, §5.1).
- **`--merge` only** (no review, no resolve, no `--show-me-comments`) → go to
  **Phase 5** (CI), then **Phase 6** (merge). Under `--cascade`, stop after
  Phase 5; `land` (§12.2) is Phase 6.

### 3.7 Operator briefing (`--show-me-comments`)

The orchestrator owns this. No new subagent. Reviewer and Author do not write
it. Skip the whole section when `--show-me-comments` is off. `--auto` does
**not** turn this flag on.

An **operator briefing** is harness-only markdown for the person who invoked
this run. One block per comment already on the PR. Not a PR comment. Not the
PR visual section. Not a posted comment view. Never HTML. Never posted.

**When to run**

- `--show-me-comments` without `--resolve` and without `--review`: after
  Phase 1 reuse/create (§3.6), fetch comments, `brief()`, STOP. No Author.
  No new posts. Under `--cascade` graph, `brief()` then return to
  `advance` — do not STOP the forest.
- `--show-me-comments --review` without `--resolve`: after Phase 2 posts the
  review (§4.7), `brief()` (including the just-posted findings), STOP.
  Under `--cascade` graph, `brief()` then return to `advance`.
- `--show-me-comments --resolve`: after the comment inventory (§5.1 /
  `pr-feedback.md` when it exists this iteration; otherwise the same fetch
  as §5.1 Step 1), `brief()`, **then** the Author addresses findings. Do
  not brief after code.
- `--auto --show-me-comments` or no TTY: write
  `.pr-autopilot/<PR_NUMBER>/operator-briefing.md`, do not prompt, continue
  the rest of the pipeline.

**Fetch**

GitHub — same two endpoints as §5.1 Step 1:

```bash
# inline review comments
gh api "repos/$SLUG/pulls/$PR/comments" --paginate \
  --jq '.[] | {id, path, line, body}'

# top-level PR conversation comments
gh api "repos/$SLUG/issues/$PR/comments" --paginate \
  --jq '.[] | {id, body}'
```

GitLab: `glab api "projects/:id/merge_requests/<IID>/discussions"` — a note
with `position.new_path` / `position.new_line` is inline; a note without
position is top-level.

When `--resolve` is on and
`.pr-autopilot/<PR_NUMBER>/iter-<N>/pr-feedback.md` already exists this
iteration, use its `path:line` and `quote` fields for CRITIQUE and QUESTION
entries. **Do not skip NOISE.** A collapsed noise count in the inventory is
not a briefing block — fall back to the fetch for those comments so every
comment already on the PR still gets quote + one view. Prefer the inventory
file for timing (after inventory, before code), not as a filter.

**Missing `show-me` skill.** If `--show-me-comments` is on and the Skill tool
cannot load `show-me`: print an alert that names `show-me` and the install
line `npx skills add FelipeOFF/skills --skill=show-me` (once per run, same
alert as §3.4 / §4.3). Skip the briefing. Do not fake views. Do not emit
HTML. Continue the rest of the pipeline.

**`brief(comments) → markdown`** — this is the seam. Done means the examples
below hold.

```
on(brief)
  if --show-me-comments is off
    return nothing
  if show-me skill missing
    alert + npx install line (once per run)
    return nothing          # do not fake views
  blocks = []
  for each comment already on the PR   # including NOISE; never skip a comment
    quote = visible remark (strip a trailing <!-- pr-autopilot:... --> marker)
    view  = exactly one of {mermaid, file tree, call tree, markdown diff}
    if comment is inline (has path and line)
      block = `path:line`
              > quote
              <blank>
              view
    else                    # top-level: no path
      block = > quote
              <blank>
              view
      never invent a path:line
  join blocks with a blank line
  never post this markdown to the PR
  never HTML
  if --auto or no TTY
    write .pr-autopilot/<PR_NUMBER>/operator-briefing.md
    do not prompt
    continue
  else
    print the markdown in the harness conversation
```

Format of a view: same as §4.3 / §3.4, one of mermaid / file tree / call
tree / markdown diff. File paths in every view go in backticks. Pick the
smallest view that makes *this* remark clear.

**Block shape**

Inline:

```
`src/foo.ts:42`
> checkout still calls chargeCard after reserveInventory fails

checkout
  reserveInventory
    chargeCard
```

Top-level (no path line):

```
> does this handle the empty cart?

cart.ts
  checkout
    empty → return
```

**Examples (completion criterion for brief):**

1. `--show-me-comments` without `--resolve` and without `--review`, existing PR → fetch comments, print briefing, STOP. No Author. No new posts. Single-PR run. Under `--cascade` graph, brief that PR and continue.
2. `--show-me-comments --review` without `--resolve` → Phase 2 posts the review, then briefing includes those findings, then STOP. Single-PR run. Under `--cascade` graph, brief that PR and continue.
3. `--show-me-comments --resolve` → briefing after inventory, before the Author touches code. Do not brief after the push.
4. `--auto --show-me-comments` or no TTY → write `.pr-autopilot/<PR>/operator-briefing.md`, do not prompt, continue.
5. Inline comment → block starts with `` `path:line` ``, then quoted remark, then exactly one comment view.
6. Top-level comment → no path line; quote + one view. Do not invent `path:line`.
7. `--show-me-comments` and `show-me` missing → one alert naming `show-me` plus `npx skills add FelipeOFF/skills --skill=show-me`; no briefing; no fake views; pipeline continues.
8. `--auto` without `--show-me-comments` → no operator briefing.
9. `brief()` output is never posted to the PR. Never HTML.
10. `state.json.show_me_comments` is whether the flag is on **this invocation** (do not inherit `true`).
11. A NOISE comment (LGTM, emoji) still gets a briefing block (quote + one view). The Author does not reply to it.

---

## 4. Phase 2 — Two-Track Review: Maintainability + Test Value

Phase 2 runs **two parallel tracks** that feed into one consolidated review:

1. **Code track** — deep maintainability audit of the PR diff for code judo, abstraction quality, file size, spaghetti growth, and structural simplification. This is the approval bar. Few high-conviction comments; do not flood nits.
2. **Test track** — test-value assessment: two independent rankers evaluate tests in the PR diff by value, followed by a consolidator that produces a final removal/justification plan

Both tracks post their findings as inline comments on the exact file + line they refer to, and the orchestrator merges them into a single `review-report.md` and a single posted GitHub/GitLab review.

**Hard requirement:** every finding must be posted as an **inline comment on the exact line of code** it refers to. A standalone PR comment (not anchored to a line) is **not** an acceptable output, except for the top-level review summary.

### 4.0 When to run the test nuke track

The orchestrator first reads the PR diff to identify test files. Use common test-file patterns: `*test*.{js,ts,py,go,rb,java}`, `*_test.go`, `test_*.py`, `*Test.java`, `*Spec.{js,ts}`, files under `__tests__/`, `tests/`, `spec/`, etc.

- **If the PR diff contains at least one test file** → run both tracks in parallel.
- **If the PR diff contains no test files** → run only the code review track, skip the test nuke track entirely, and record that in `review-report.md` (`test_nuke: skipped — no tests in diff`).

Scoping: the test nuke track evaluates tests **in the PR diff** and tests they clearly depend on (e.g. shared test helpers imported by those tests). It does not require ranking the entire repo suite unless the PR is test-only and the diff is small (<200 lines of test code).

### 4.1 Code track — deep maintainability audit

Spawn one `Task` subagent with `subagent_type: "general-purpose"` (or `code-reviewer` if available). This replaces the old "correctness-only" reviewer with a deep maintainability audit. The prompt template in §4.5 applies here.

**Composition**: The Reviewer MUST load the `thermo-nuclear-code-quality-review` skill via the Skill tool before auditing the diff (§4.5). That loaded skill IS the review standard: core prompt, rules 0–7, questions, flag list, remedies, tone, output priority, approval bar.

**Install**: `npx skills add https://github.com/cursor/plugins --skill thermo-nuclear-code-quality-review` then `/reload-plugins` in Claude Code. [Catalog](https://www.skills.sh/cursor/plugins/thermo-nuclear-code-quality-review) | [Source](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review)

Upstream skill has `disable-model-invocation: true` (explicit ask required); inside pr-autopilot, `--review` / `--auto` IS that explicit ask. Do not run this on `--resolve`-only.

**Fallback rules** (if the Skill tool cannot load the upstream skill):
- Perform a deep code quality audit of the PR diff
- Be ambitious about structural simplification; look for "code judo" moves that delete complexity
- Do not let a PR push a file <1k → >1k lines without very strong reason
- Do not allow random spaghetti growth (ad-hoc conditionals in unrelated flows)
- Bias toward cleaning the design, not just accepting working code
- Prefer direct, boring, maintainable code over hacky or magical
- Push hard on type and boundary cleanliness
- Keep logic in canonical layer, reuse existing helpers
- Treat unnecessary sequential orchestration and non-atomic updates as design smells
- Presumptive BLOCKERS: preserves complexity when code-judo would delete it; <1k → >1k lines; ad-hoc branching tangles flow; scatters feature checks; unnecessary abstraction/wrapper; duplicates helper or wrong layer
- Approval bar: do NOT approve merely because behavior works
- Few high-conviction comments; do not flood nits
- Extra lens: Keep ponytail as additional anti-over-engineering check (loaded separately via Skill tool)

The Reviewer reads the PR diff, applies the rules above, classifies each finding as BLOCKER/SUGGESTION/NITPICK, and writes `.pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md` with the list of findings. **Do not post the review to the PR yet** — the orchestrator will merge findings from both tracks before posting.

### 4.2 Test track — test-value assessment

This track runs in parallel with the code track, only when the PR diff contains test files (§4.0).

**Step A — spawn two independent rankers**

Launch two `Task` subagents **in parallel**, each isolated (no shared context), ideally with different models if the harness supports model selection per Task, else two separate Task invocations with `subagent_type: "general-purpose"`.

Both receive **the same prompt**:

```
You are a test-quality ranker in the pr-autopilot pipeline.

PR: <PR_URL>
PR number: <PR_NUMBER>
Iteration: <N>
Repo root: <CWD>

Your task:
1. Read the PR diff: git diff <BASE>...<BRANCH>
2. Identify every test file in the diff (test*.{js,ts,py,go}, *_test.go, test_*.py,
   *Test.java, *Spec.{js,ts}, files under __tests__/, tests/, spec/, etc.)
3. For each test in those files, and for tests they clearly depend on (e.g. shared
   test helpers imported by the changed tests):
   - What does this test assert?
   - What value does it provide? (catches regressions, documents behavior, guards
     edge cases, prevents data loss, etc.)
   - What is the cost? (runtime, brittleness, false positives, maintenance burden)
4. Stack-rank the tests by net value (value minus cost).
5. Identify candidates for removal:
   - Tests that assert tautologies (mocking the unit under test so nothing real is checked)
   - Tests that are always-green no matter what the code does (flaky in the "never fails" sense)
   - Tests that duplicate coverage another test already provides with less cost
   - Tests with unjustified cost (slow, brittle, unclear intent)

Output format:
Write a markdown document with these sections:

## High-value tests (keep)
- `<file>:<line>` — `<test name>` — <why it is valuable, 1-2 sentences>

## Medium-value tests
- `<file>:<line>` — `<test name>` — <value vs cost tradeoff, 1-2 sentences>

## Candidates for removal
- `<file>:<line>` — `<test name>` — <why it should be removed, objective justification>

## Summary
<2-3 sentences on the overall test quality in this PR>

Be specific. Cite line numbers. Every candidate for removal must carry an objective,
technical justification — "low value" alone is not enough. A test that correctly
asserts real behavior and catches real regressions is not a candidate, even if you
think the code is simple.
```

Each ranker writes its output to a local file:
- Ranker 1 → `.pr-autopilot/<PR_NUMBER>/iter-<N>/test-ranker-a.md`
- Ranker 2 → `.pr-autopilot/<PR_NUMBER>/iter-<N>/test-ranker-b.md`

The orchestrator waits for both rankers to complete before proceeding.

**Step B — spawn the consolidator**

Launch one `Task` subagent with `subagent_type: "general-purpose"`, with **no inherited review context** (isolated), given only the two ranker outputs:

```
You are the test-value consolidator in the pr-autopilot pipeline.

PR: <PR_URL>
PR number: <PR_NUMBER>
Iteration: <N>
Repo root: <CWD>

Your inputs:
- .pr-autopilot/<PR_NUMBER>/iter-<N>/test-ranker-a.md  (ranker 1)
- .pr-autopilot/<PR_NUMBER>/iter-<N>/test-ranker-b.md  (ranker 2)

Your task:
1. Read both ranker reports.
2. Compare their "candidates for removal" lists.
3. For each test that EITHER ranker flagged:
   - If both agree it should be removed, and the justification is objective and technical
     (tautology, always-green, pure duplication, unjustified cost), include it in the
     final removal list.
   - If only one ranker flagged it, include it ONLY if that ranker's justification is
     objective, specific, and technically sound. The other ranker's silence is not a veto.
   - If both flagged it but with conflicting reasons, reconcile them or exclude it if the
     justifications are too weak.
4. For each test that survives (high-value or medium-value), check whether both rankers
   agree. If one says "remove" and the other says "keep" with a strong justification for
   keeping, exclude it from removals.
5. Build one consolidated plan:

## Consolidated removal candidates
- `<file>:<line>` — `<test name>` — <consolidated justification, objective and specific>

## Tests to keep (high confidence)
- `<file>:<line>` — `<test name>` — <why both rankers agreed it is valuable>

## Step-by-step changes
For each removal candidate:
1. `<file>:<line>` — Remove `<test name>` — <why>
2. ...

Every addition and removal must be justified objectively. "Low value" or "redundant"
without citing the specific duplication or tautology is not sufficient. Missing
justification is not a BLOCKER by itself — downgrade to SUGGESTION.

Write your output to .pr-autopilot/<PR_NUMBER>/iter-<N>/test-consolidated.md
```

The consolidator writes `.pr-autopilot/<PR_NUMBER>/iter-<N>/test-consolidated.md`.

**Step C — map to inline comments**

The orchestrator reads `test-consolidated.md` and converts each removal candidate into an inline comment on the test file:

- **Candidate for removal, strong justification (tautology / always-green / mocking the unit under test)** → `BLOCKER` severity, posted as an inline comment on the test's opening line.
- **Candidate for removal, weaker justification (unjustified cost / unclear duplication)** → `SUGGESTION` severity.
- **Missing justification** → `SUGGESTION` (not BLOCKER).

The comment body follows the same format as code-review findings (§4.5):
`posted(finding, …)` (§0.4) — humanized, then unslopped when `--unslop` is
on — opens with `Blocking:` or `Suggestion:`, closes with
`<!-- pr-autopilot:severity=blocker|suggestion -->`.

Example:

```markdown
Blocking: this test mocks `calculateTotal` and asserts the mock's return value, so it never exercises the real calculation. It cannot catch regressions.

<!-- pr-autopilot:severity=blocker -->
```

These test-track findings are added to the same `findings` array the code track produces, before the orchestrator posts the consolidated review in §4.6. When `--show-me` is on, each of them goes through **posted()** (§4.3) the same way as a code-track finding, so it also gets exactly one comment view.

### 4.3 Comment views on findings (`--show-me --review`)

A **comment view** is a show-me view inside a posted Reviewer finding. Same four
shapes as a PR visual (mermaid, file tree, call tree, markdown diff). Never HTML.
Not the PR visual section. One view per finding, in the same inline comment, on
the same line as the finding. The marker stays alone on the last line. Author
replies and posted CI triage comments get the same treatment under
`--show-me --resolve` (§5.8).

Skip this whole section when `--show-me` is off **or** `--review` is off.
`--review` without `--show-me` stays prose-only. `--show-me` without `--review`
still only means the PR visual section (§3.4) unless `--resolve` is also on
(§5.8). `--auto` does not turn `--show-me` on; `--auto --show-me` does, and
because `--auto` already turns on `--review`, findings get comment views too.

The PR visual section is unchanged: description only, at most two views,
`apply()` as in §3.4, opener bit-identical. Reviewer and Author still must not
rewrite the PR description. The operator briefing (`--show-me-comments`, §3.7)
is a separate surface — harness-only, never posted as a finding.

**Who writes the view.** The Reviewer prompt includes this run's `--show-me` bit
and, when it is on, loads `show-me` to pick one view per finding. The orchestrator
runs **posted()** below before the GitHub/GitLab review POST, so a missing view is
filled when the skill loaded, or omitted when it did not. The Author does not
write finding bodies.

**Missing `show-me` skill.** If `--show-me` is on and the Skill tool cannot load
`show-me`: print an alert that names `show-me` and the install line
`npx skills add FelipeOFF/skills --skill=show-me` (once per run, same alert as
§3.4 / §3.7). Do not emit HTML. Do not silently invent comment views. Post the findings
as prose + marker. Continue the rest of the pipeline (PR created, review posted,
resolve if that flag is on). The PR visual section still uses the condensed
fallback in §3.4.

**`posted(finding) → body`** — same seam as §0.4, `kind=finding`. Done means
the examples below hold. Do not run humanizer or unslop a second time.

```
on(posted_finding)
  return posted(finding, draft, flags)   # §0.4: humanizer, unslop, view, marker
```

Format of a view (same as §3.4, one of):

- mermaid → a fenced block with language `mermaid` (flowchart or sequence)
- file tree → indented tree; every path in backticks
- call tree → indented calls; paths in backticks
- markdown diff → a fenced block with language `diff`

File paths in every view go in backticks. Pick the smallest view that makes
*this* finding clear — a missing session guard is a three-line call tree, not a
map of the repo.

**Examples (completion criterion for posted):**

1. `--review` without `--show-me` → each finding is humanized prose + marker last line; no mermaid / file tree / call tree / markdown-diff view.
2. `--show-me --review`, skill present → each finding (code track and test track) has exactly one of those four shapes; marker last line; PR visual section still `apply()` from §3.4 (≤2 views, opener bit-identical).
3. `--show-me --review`, skill missing → one alert naming `show-me` plus `npx skills add FelipeOFF/skills --skill=show-me`; findings posted with no comment view and no HTML; pipeline continues; PR visual section still uses the §3.4 fallback.
4. `--show-me` without `--review` → no review comments generated; PR visual section only.
5. Finding body with a comment view → last non-empty line is `<!-- pr-autopilot:severity=… -->`.
6. Draft finding with two views → posted body keeps the first, drops the second; marker still last.

Posted shape when `--show-me --review` and the skill loaded:

```markdown
Blocking: checkout still calls `chargeCard` after `reserveInventory` fails, so
the customer is billed for a hold that never lands.

checkout
  reserveInventory
    chargeCard

<!-- pr-autopilot:severity=blocker -->
```

Without `--show-me`, that same finding is the prose and the marker, nothing in
between.

### 4.4 How to post inline comments (both tracks)

This section applies to both the code-review track and the test-nuke track. The orchestrator collects findings from both tracks and posts them in one GitHub/GitLab review.

#### GitHub — single review with inline comments

The Reviewer must build all comments and submit them in **one** review using `gh api`:

```bash
# 1. Determine commit SHA the comments anchor to (the latest commit on HEAD)
COMMIT_SHA=$(git rev-parse HEAD)

# 2. POST the review with inline comments in a single call.
#    Each comment carries: path, line, side ("RIGHT" for added/modified lines,
#    "LEFT" for removed-only context), the posted() body from §4.3 (humanized
#    prose, optional comment view, invisible severity marker on the last line).
gh api -X POST "repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews" \
  -f commit_id="$COMMIT_SHA" \
  -f event="REQUEST_CHANGES" \   # or "COMMENT" if blocker_count == 0
  -f body="<top-level summary>" \
  -F "comments[][path]=src/foo.ts"      -F "comments[][line]=42"  -F "comments[][side]=RIGHT" \
  -F "comments[][body]=Blocking: <what breaks and why>\n\n\`\`\`ts\n<the lazy fix>\n\`\`\`\n\n<!-- pr-autopilot:severity=blocker -->" \
  -F "comments[][path]=src/bar.ts"      -F "comments[][line]=88"  -F "comments[][side]=RIGHT" \
  -F "comments[][body]=Suggestion: ...\n\n<!-- pr-autopilot:severity=suggestion -->" \
  ...
```

For a multi-line comment, use `start_line` + `start_side` + `line` + `side` instead of just `line`.

Every inline comment body is **one** `posted(finding, …)` call (§0.4 / §4.3):
humanized, then unslopped when `--unslop` is on, optionally one comment view
when `--show-me` is on and `show-me` loaded, opening the way a reviewer
speaks (`Blocking:` / `Suggestion:` / `nit:`), and **must** end with exactly one
severity marker alone on its last line:
`<!-- pr-autopilot:severity=blocker|suggestion|nitpick -->`. Never unslop the
marker. That marker, not the prose, is what the Author parses next (§0.3). The
comment is still anchored to the finding's file and line — the view lives in
the body, not as a second comment. Never HTML.

If `gh api` rejects a `line` (e.g. the line is unchanged in the diff), the Reviewer must anchor to the **nearest changed line** in the same hunk and prefix the body with `(near line X)` so the location is clear. Never silently drop a finding.

#### GitLab — discussions on diff position

```bash
# Need: project_id, MR iid, base_sha, head_sha, start_sha
# Get them from: glab api projects/:id/merge_requests/<iid>?include_diverged_commits_count=true

glab api -X POST "projects/:id/merge_requests/<MR_IID>/discussions" \
  -F body="<posted() body from §4.3>" \
  -F position[position_type]=text \
  -F position[base_sha]=$BASE_SHA \
  -F position[head_sha]=$HEAD_SHA \
  -F position[start_sha]=$START_SHA \
  -F position[new_path]=src/foo.ts \
  -F position[new_line]=42
```

Repeat per finding. GitLab does not bundle them into a single review object.

### 4.5 Reviewer prompt template (code track — deep maintainability audit)

This template is for the code-track subagent. The orchestrator will merge your findings with those from the test track (if it ran) before posting the review.

```
You are the Reviewer agent in the pr-autopilot pipeline (code track — deep
maintainability audit). You are stateless and have no prior context — everything you
need is below.

PR: <PR_URL>
Platform: <github|gitlab>
PR number / MR iid: <PR_NUMBER>
Owner/repo (or project_id): <SLUG>
Base: <BASE>
Head: <BRANCH>
Head SHA: <HEAD_SHA>
Iteration: <N> of <MAX>
Repo root: <CWD>
show_me: <true|false>   (this invocation only; do not inherit from an older run)
Unslop: <off | on, skill loaded | on, skill missing — humanizer only, do not fake>
Soul login: <login | n/a>
Soul sample: <quoted comments this account already left on this repo | no sample — first person, no invented voice>

LOAD YOUR SKILLS FIRST (in this order)
1. `thermo-nuclear-code-quality-review` (Skill tool, skill: "thermo-nuclear-code-quality-review")
   BEFORE reading the diff. This IS the review standard: core prompt, rules 0–7,
   questions, flag list, remedies, tone, output priority, approval bar. If unavailable,
   fall back to the condensed FALLBACK RULES below.
2. `ponytail` (Skill tool, skill: "ponytail", falling back to "ponytail:ponytail")
   as an extra anti-over-engineering check AFTER the maintainability audit. Does this
   need to exist at all? Does the repo already have it? stdlib? native platform?
   installed dependency? one line?
3. `humanizer` (Skill tool, skill: "humanizer") before you post anything. It owns
   every word of prose you write. The maintainability audit is direct and demanding;
   humanizer strips AI tells but keeps the directness.
4. If show_me is true: `show-me` (Skill tool, skill: "show-me") for **one comment
   view per finding** from {mermaid, file tree, call tree, markdown diff}. Never
   HTML. If it cannot load, write prose + marker only — do not invent a view, do
   not emit HTML. The orchestrator will alert and print the install line.
5. `unslop` (Skill tool, skill: "unslop") AFTER humanizer, ONLY if Unslop is on
   and the skill loaded. Write in Soul login's first person using Soul sample.
   If Unslop is on but the skill is missing, do not fake the pass — post the
   humanizer output. If Unslop is off, skip this skill.

If `thermo-nuclear-code-quality-review`, `ponytail`, or `humanizer` is unavailable
in your harness, the FALLBACK RULES and HOUSE STYLE blocks below carry the
condensed version — apply those by hand. `show-me` is different: no condensed
fake comment view when show_me is true and the skill is missing. Unslop has no
condensed fallback. If it is missing with the flag on, the orchestrator already
printed the npx install alert; you continue humanizer-only.

Do not edit the PR description. The orchestrator owns the PR visual section.
Do not write an operator briefing. The orchestrator owns `--show-me-comments`.

YOUR TASK
1. Read the full diff: git diff <BASE>...<BRANCH>
2. Read the changed files in their current state.
3. Apply the `thermo-nuclear-code-quality-review` skill you loaded above. It defines
   the review standard: core prompt, rules 0–7, questions, flag list, remedies, tone,
   output priority, approval bar.
4. Apply the `ponytail` lens as an extra anti-over-engineering check.

CLASSIFICATION
Each finding is exactly one of:
  BLOCKER    — presumptive blocker from the loaded skill, or major structural regression
  SUGGESTION — should likely be fixed, but not a blocker
  NITPICK    — optional/aesthetic

FALLBACK RULES (use ONLY if the skill failed to load)
If `thermo-nuclear-code-quality-review` is unavailable:
- Perform deep code quality audit; be ambitious about structural simplification
- Look for "code judo" moves that delete complexity rather than rearrange it
- Do not let PR push file <1k → >1k lines without very strong reason
- Do not allow random spaghetti growth (ad-hoc conditionals in unrelated flows)
- Bias toward cleaning design, not just accepting working code
- Prefer direct, boring, maintainable over hacky or magical
- Push hard on type and boundary cleanliness
- Keep logic in canonical layer, reuse existing helpers
- Treat unnecessary sequential orchestration and non-atomic updates as design smells
- Presumptive BLOCKERS: preserves complexity when code-judo would delete it; <1k → >1k
  lines; ad-hoc branching tangles flow; scatters feature checks; unnecessary
  abstraction/wrapper; duplicates helper or wrong layer
- Approval bar: do NOT approve merely because behavior works
- Few high-conviction comments; do not flood nits

FINDINGS FORMAT (do NOT post the review to the PR yet)
You MUST format each finding as an INLINE comment anchored to the exact file +
line number, but write them to the local artifact only. The orchestrator will merge
your findings with the test-nuke track (if it ran) and post one consolidated review.

Structure each finding with:
- path (file path)
- line (or start_line + line for multi-line)
- side ("RIGHT" for added/modified, "LEFT" for removed-only context)
- body (posted prose + optional comment view + severity marker — humanizer, then unslop if Unslop is on)

The orchestrator will assemble the posted body from this (prose, optional view,
marker) before the host POST. You do not post the review.

COMMENT FORMAT — write like a reviewer, not like a form
Never open a comment with `[BLOCKER]`, `[SUGGESTION]`, `[NITPICK]` or a status
emoji. Open with the words a reviewer says out loud, say what breaks and where.
If show_me is true and `show-me` loaded, put exactly one comment view (mermaid,
file tree, call tree, or markdown diff — never HTML) after the prose. Close the
body with one invisible severity marker alone on the last line. The marker is
what the pipeline parses; the prose is what the human reads.

  Blocking: the /admin/users handler trusts the X-User header without checking it,
  so anyone can set that header and read the admin list.

  The rest of the handlers already use the session guard:

  ```ts
  if (!req.session?.isAdmin) return res.status(403).end();
  ```

  <!-- pr-autopilot:severity=blocker -->

When show_me is true, that same finding includes one view above the marker, e.g.
a call tree of the missing guard. Never two views. Never HTML. If show_me is
false, omit the view.

Openers and markers:
  BLOCKER    → "Blocking: …"    <!-- pr-autopilot:severity=blocker -->
  SUGGESTION → "Suggestion: …"  <!-- pr-autopilot:severity=suggestion -->
  NITPICK    → "nit: …"         <!-- pr-autopilot:severity=nitpick -->
Exactly one marker per comment. Never reword or reformat it.

If the diff makes a line uncommentable (unchanged context outside the hunk),
anchor to the nearest CHANGED line in the same hunk and open the body with
`(near line N)`. Never silently drop a finding.

──────────────────────────────────────────────────────────────────────────────
HOUSE STYLE (mandatory) — humanize the prose, unslop the voice, ponytail the code

PROSE. Draft → `humanizer` (Skill tool, skill: "humanizer") → `unslop` if Unslop
is on and the skill loaded (Skill tool, skill: "unslop"). Post that, never the
raw draft. If humanizer is unavailable, strip the tells yourself: status stamps
and emoji openers, rule of three ("cleaner, safer, and easier to maintain"), em
dash pile-ups, "not just X but Y", promotional adjectives (robust, seamless,
comprehensive), AI vocabulary (leverage, delve, crucial, underscore, ensure),
trailing "-ing" analysis ("…, ensuring maintainability"), vague attribution ("best
practice suggests"), filler ("it's worth noting that", "in order to"), generic
closers ("Overall this improves code quality"), and formulaic praise ("Great work
on this PR!"). Short sentences. Name the file, the line and the consequence. No
emoji unless the repo already uses them.
If Unslop is on and loaded, write in Soul login's first person using Soul sample.
No sample → first person, no invented pastiche. If Unslop is on but missing, do
not fake it. If Unslop is off, skip it.
Humanize and unslop the prose only. Code snippets, file paths, line refs, comment
views (mermaid fences, file trees, call trees, markdown diffs) and the trailing
marker stay exactly as drafted. Never unslop the marker. The marker stays alone
on the last line.

CODE. Every snippet you suggest goes through `ponytail` first, stopping at the first
rung that holds: does this need to exist at all → does the repo already have it
(helper, util, type, pattern) → does the stdlib do it → does a native platform
feature cover it → does an already-installed dependency solve it → can it be one
line → only then the minimum code that works. Never suggest a refactor larger than
the bug. Never suggest a new dependency for what a few lines do. Deleting code is a
valid suggestion.
Do not apply the lazy lens to input validation at trust boundaries, error handling
that prevents data loss, security, or accessibility — those get flagged when they
are missing, never simplified away.

OUTPUT (write local artifact only, do NOT post to PR)
Write .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md with this exact
front-matter and a list of every finding in a structured format the orchestrator
can merge with test-nuke findings:

---
verdict: APPROVED | CHANGES_REQUESTED
blocker_count: <int>
suggestion_count: <int>
nitpick_count: <int>
track: code-review
---

# Review — iteration <N>

## Summary
<2–4 sentences — this will become the top-level review body after merging tracks>

## Inline findings

### [BLOCKER] <title>
- path: `src/file.ts`
- line: 42
- side: RIGHT
- body: |
  Blocking: the /admin/users handler trusts the X-User header without checking it,
  so anyone can set that header and read the admin list.

  The rest of the handlers already use the session guard:

  ```ts
  if (!req.session?.isAdmin) return res.status(403).end();
  ```

  <!-- pr-autopilot:severity=blocker -->

(The uppercase severity label is local machine state, never posted. The body's
trailing marker is what the orchestrator and the Author parse.)

(repeat per finding)

## Verdict
APPROVED  (only if blocker_count == 0)
or CHANGES_REQUESTED

Be specific. Do not write speculative findings. The orchestrator will merge this
with test-nuke findings (if any) and post one consolidated GitHub/GitLab review.
```

### 4.6 Orchestrator — merge tracks and post one review

After both tracks complete (or after the code track alone when no tests are in the diff), the orchestrator:

1. **Read the code-track artifact**: `.pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md`
2. **Read the test-track artifact** (if it ran): `.pr-autopilot/<PR_NUMBER>/iter-<N>/test-consolidated.md`
3. **Parse findings from both**:
   - Code-track findings are already structured with `path`, `line`, `side`, `body` in `review-report.md`
   - Test-track findings are in `test-consolidated.md` under "Consolidated removal candidates" — convert each to the same structure:
     - Extract `file:line` from the bullet (`src/foo.test.ts:42`)
     - `path` = `src/foo.test.ts`
     - `line` = `42`
     - `side` = `RIGHT` (tests are always in the new side of the diff)
     - `body` = `posted(finding, justification, flags)` (§0.4) + severity marker
       (humanizer, then unslop if `--unslop`; marker last line, never rewritten).
       posted() in step 7 adds the comment view when `--show-me` is on.
     - Severity: tautology / always-green / mocking-the-unit = `blocker`, weaker justifications = `suggestion`
4. **Deduplicate**: if both tracks flagged the same line (rare), keep the BLOCKER if either is a BLOCKER, else merge the prose.
5. **Update the front-matter** of `review-report.md`:
   - Recalculate `blocker_count`, `suggestion_count`, `nitpick_count` across both tracks
   - Set `verdict: CHANGES_REQUESTED` if any BLOCKER, else `APPROVED`
   - Add `test_track: ran` or `test_track: skipped — no tests in diff`
6. **Append test-track findings** to the "## Inline findings" section of `review-report.md`, preserving the structured format.
7. **Run `posted(finding, …)` once (§0.4 / §4.3)** before the host POST. That
   is the body that goes to GitHub/GitLab. Do not run humanizer again:
   - `--review` without `--show-me` → prose + marker, no comment view (strip a
     view if a confused Reviewer included one)
   - `--show-me --review` and `show-me` loaded → exactly one comment view;
     generate one if the Reviewer omitted it; if two, keep the first
   - `--show-me` on and `show-me` missing → already alerted in §3.4 / §4.3;
     post prose + marker, no HTML, no invented view
   - Marker is the last line in every case
8. **Post the consolidated review** to GitHub/GitLab using those posted bodies:
   - GitHub: one `gh api -X POST repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews` with all `comments[]` from both tracks, `event=REQUEST_CHANGES` if any BLOCKER, else `COMMENT`
   - GitLab: one `glab api POST` per finding (GitLab doesn't batch them)
9. **Record `comment_id` and `url`** for each posted finding back into `review-report.md` (the Author needs them in Phase 3).

The result: one `review-report.md` with findings from both tracks, and one posted review on the PR with inline comments on code files (from the code-review track) and test files (from the test-nuke track).

### 4.7 Orchestrator post-processing

After both tracks complete and the consolidated review is posted (§4.6), parse the
merged front-matter of `review-report.md` and **route**. `--resolve`/`--auto` does
not skip the Author when the Reviewer approved.

- **`--resolve` or `--auto` on** → proceed to **Phase 3**, including when
  `verdict: APPROVED` and `blocker_count: 0`. Do **not** jump to Phase 5. That
  Author round still inventories every comment already on the PR (§5.1), checks
  merge conflicts (§5.3), and attributes CI (§5.4). External CI stays external —
  never patch around it. `Trigger=review` when Phase 2 just ran (so
  `review-report.md` is in scope for dedup). If `--show-me-comments` is on,
  brief after inventory and before code (§3.7). After Phase 3, §5.7 decides
  whether to re-review or poll CI.
- **`--review` without `--resolve`** (and without `--auto`):
  - If `--show-me-comments` is on, run **§3.7** first (the briefing includes
    the just-posted findings). Then STOP. No Author. `--merge` does not
    override this stop. Under `--cascade` graph, brief and return to
    `advance` — do not STOP the forest.
  - `verdict: APPROVED` and `--merge` on (and `--show-me-comments` off) →
    jump to **Phase 5** (CI). No Author.
  - otherwise → STOP. Print the PR URL and exit. No Author. No `conflict:` / `CI:`
    lines from resolve.
- **`--resolve` off and `verdict: CHANGES_REQUESTED`** → STOP (mode "PR + review").
  Print the PR URL and exit. Under `--cascade`, `blocker_count > 0` here
  is forest halt (§12.2).
- Malformed front-matter, or any finding without a `comment_id` → re-spawn tracks
  once with explicit format reminder; on second failure, escalate to user.

The `blocker_count`, `suggestion_count`, and `nitpick_count` in the front-matter
now reflect the sum of findings from both the code track and the test track (when
it ran). The Author in Phase 3 works the merged `review-report.md` the same way it
always has — it sees no difference between a finding from the code track and one
from the test track.

**Examples (completion criterion for this routing):**

1. `--review --resolve`, `verdict: APPROVED`, `blocker_count: 0` → Phase 3 runs.
   Inventory + conflict check + CI attribution. Terminal includes
   `conflict: none|resolved|escalated` and `CI: green|fixed|escalated|not-run`.
2. `--auto`, `verdict: APPROVED`, `blocker_count: 0` → Phase 3 runs (same lines).
3. `--review` without `--resolve` and without `--merge`, any verdict → STOP after
   Phase 2. No Author. Those two lines are absent.
4. `--review --merge` without `--resolve`, `verdict: APPROVED` → Phase 5. No Author.
5. `--review --resolve`, `verdict: CHANGES_REQUESTED` → Phase 3 (unchanged).
6. Quiet pass (no comments to address, MERGEABLE, checks green) → `conflict: none`
   and `CI: green`, then Phase 5. Does not re-enter Phase 2.
7. A red check attributed `external` → not patched around. Record `ci: escalated`
   when non-interactive / `--auto`.
8. `--show-me-comments --review` without `--resolve` → after the review is posted,
   run §3.7 (includes those findings), STOP. No Author. No new posts beyond the
   review itself. `--merge` does not override this stop. Under `--cascade`
   graph, brief and return to `advance`.

---

## 5. Phase 3 — Author Subagent (Resolve everything: PR feedback, conflicts, CI)

This phase only runs when `--resolve` (or `--auto`) is set. `--review` without
`--resolve` stops at the end of Phase 2 — no Author. `--show-me-comments`
without `--resolve` also stops before this phase (after §3.7).

When `--resolve`/`--auto` is on, Phase 3 **always** runs after Phase 2, including
when `verdict: APPROVED` and `blocker_count: 0`. Do not skip to Phase 5. Inventory,
conflict check, and CI attribution happen every time. External CI is still not
patched around (§5.4).

When `--show-me-comments` is also on, the orchestrator runs `brief()` (§3.7)
**after** the inventory (§5.1 / `pr-feedback.md`) and **before** the Author
addresses findings (§5.2). Spawn the Author with `Trigger=inventory` first if
`pr-feedback.md` is missing this iteration; wait for that artifact; brief;
then spawn the Author again with `Trigger=pr-feedback` / `review` / `ci-fix`
as today. Run `brief()` **once this invocation**, on that first inventory.
Skip it on `Trigger=ci-fix` and on later iterations. Do not brief after code.
No new subagent.

The Author owns the **whole PR**, not just the findings pr-autopilot itself produced.
Its job is to make the PR clean and mergeable. It has four responsibilities, in this
order:

1. **Inventory & triage every comment already on the PR** — human or bot, inline or top-level (§5.1).
2. **Address each actionable finding** — fix, refute, defer or answer, with an inline reply on the comment (§5.2).
3. **Merge conflicts** — check mergeability every round; resolve if CONFLICTING (§5.3).
4. **CI** — read check status every round; attribute and fix only a failure this PR caused (§5.4).

All four respect the **business-logic escalation protocol** (§5.5): the Author never
silently changes a business rule. When a comment, a conflict or a CI fix would alter
what the software decides, allows, blocks, or charges, it stops and consults the user
through the `groom-me` skill first.

**Hard requirement:** every actionable comment gets an inline **reply** on that same
comment. The reply says in plain language what happened to that finding, and carries
the invisible action marker that records it for the pipeline (§0.3). A standalone
"I addressed everything" PR comment is **not** acceptable.

### 5.1 Inventory & triage every comment on the PR

The Author never works from `review-report.md` alone. A review left by a teammate, by
GitHub Copilot, by CodeRabbit, by SonarCloud or by any other bot is a real finding and
gets the same treatment. This inventory runs even when the Reviewer just approved —
other people's comments, bots, and unanswered threads are still in scope. When
`Trigger=pr-feedback` (a `--resolve` run without `--review`), this inventory is the
*only* source of findings — there is no `review-report.md` at all.

**Step 1 — pull everything.**

GitHub:

```bash
PR=<PR_NUMBER>; SLUG=<owner>/<repo>

# inline review comments (anchored to a line of the diff)
gh api "repos/$SLUG/pulls/$PR/comments" --paginate \
  --jq '.[] | {id, user: .user.login, bot: (.user.type == "Bot"), path, line, body, in_reply_to_id}'

# top-level PR conversation comments
gh api "repos/$SLUG/issues/$PR/comments" --paginate \
  --jq '.[] | {id, user: .user.login, bot: (.user.type == "Bot"), body}'

# review bodies and verdicts (APPROVED / CHANGES_REQUESTED / COMMENTED)
gh api "repos/$SLUG/pulls/$PR/reviews" --paginate \
  --jq '.[] | {id, user: .user.login, state, body}'

# which threads are already resolved — REST does not expose this, GraphQL does
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes {
            id isResolved isOutdated
            comments(first:1) { nodes { databaseId author { login } } }
          }
        }
      }
    }
  }' -F owner=<owner> -F repo=<repo> -F pr="$PR"
```

GitLab:

```bash
glab api "projects/:id/merge_requests/<IID>/discussions" --paginate
# each discussion carries .notes[] with {id, author.username, body, resolved,
# resolvable, position} — `resolved` is the equivalent of GitHub's isResolved
```

**Step 2 — classify every comment.** Exactly one class each:

| Class | What it looks like | Action |
|-------|--------------------|--------|
| `CRITIQUE` | Asks for a change: bug, risk, missing test, naming, "why not X?", a `CHANGES_REQUESTED` review body | Decide FIX / REFUTE / DEFER in §5.2 |
| `QUESTION` | Wants an answer, not a code change ("does this handle the empty case?") | Answer it in plain prose, mark `action=answered`, no commit |
| `NOISE` | "LGTM", praise, emoji, CI status chatter, duplicated bot output | Count it, reply to nothing — no comment view either |
| `ALREADY_HANDLED` | Thread is `isResolved`/`resolved`, or a later reply already carries a pr-autopilot action marker | Skip — never re-answer, no second reply, no new view |

**The Author's own past replies are state, not input.** A comment written by the
account pr-autopilot runs under, whose body carries an
`<!-- pr-autopilot:action=... -->` marker, marks its parent thread
`ALREADY_HANDLED`. Replies left by older versions of this skill open with a status
tag instead (`✅ FIXED` / `🛑 REFUTED` / `⏸ DEFERRED` / `🤷 SKIPPED` / `💬 ANSWERED`)
and count the same. Reading those replies is how the Author knows what iteration
N-1 already did; treating them as new findings is how it would spend forever
answering itself.

**Deduplicate against `review-report.md`.** Under `--review --resolve`, the comments
the Reviewer just posted show up in both sources. Match them by `comment_id` and keep
the `review-report.md` entry — it already carries the severity and the reasoning.
Never open two work items, and never post two replies, for one comment.

**Step 3 — assign a severity.** External comments arrive without pr-autopilot's
severity markers, so infer one:

- `BLOCKER` — the comment belongs to a `CHANGES_REQUESTED` review, or names a bug, a security hole, data loss, or a broken contract.
- `SUGGESTION` — a real improvement that is not blocking.
- `NITPICK` — style or preference, or explicitly marked "nit"/"nitpick"/"optional"/"non-blocking".

When it is ambiguous, treat it as `SUGGESTION`. Never downgrade a comment that came
from a `CHANGES_REQUESTED` review — a human blocking the PR outranks the Author's
reading of the wording.

**Step 4 — write the inventory before touching code**, to
`.pr-autopilot/<PR_NUMBER>/iter-<N>/pr-feedback.md`:

```markdown
---
total_comments: <int>
critique: <int>
question: <int>
noise: <int>
already_handled: <int>
changes_requested_by: <login, login | none>
---

# PR feedback inventory — iteration <N>

## [BLOCKER] <short title>
- source: inline | top-level | review-body
- comment_id: <id>            (GitLab: discussion_id/note_id)
- author: <login> (human | bot)
- path:line: <file>:<line>    (n/a for top-level)
- class: CRITIQUE
- business_rule: yes | no     (yes ⇒ groom-me before coding, §5.5)
- quote: "<the comment, trimmed>"

(repeat per comment; NOISE entries may be collapsed into a single count line)
```

`business_rule: yes` on any entry is what routes that finding through `groom-me` in
§5.2. Decide it here, while reading, not later while coding.

**Operator briefing.** If `--show-me-comments` is on this run, the orchestrator
now runs `brief()` (§3.7) from this inventory — print it in the harness, or
write `.pr-autopilot/<PR_NUMBER>/operator-briefing.md` when `--auto` or there
is no TTY — **then** the Author addresses findings (§5.2). Do not brief after
code. The Author does not write the briefing and still must not edit the PR
description.

### 5.2 Address findings & reply inline

Work the inventory in severity order (BLOCKER → SUGGESTION → NITPICK), plus every
finding in `review-report.md` when `Trigger=review`.

| Severity | Obligation | Marker |
|----------|------------|--------|
| `BLOCKER` | Must be addressed: apply a fix, or refute it with concrete code evidence. Refusing a BLOCKER without refutation is not allowed. | `action=fixed` / `action=refuted` |
| `SUGGESTION` | Apply if low-risk and within PR scope, else defer with a reason. | `action=fixed` / `action=deferred` |
| `NITPICK` | Apply if trivial, else leave it alone. | `action=fixed` / `action=skipped` |
| `QUESTION` | Answer it. No commit needed. | `action=answered` |

A finding marked `business_rule: yes` goes through `groom-me` (§5.5) **before** any
code is written for it.

Every code change written here goes through `ponytail` first (§0.2): reuse what the
repo already has, smallest diff that fixes the root cause, no refactor larger than
the finding that triggered it.

#### GitHub — reply to a specific review comment

```bash
# Reply on an existing pull-request review comment:
gh api -X POST "repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<comment_id>/replies" \
  -f body="Good catch. Switched that path to the session.isAdmin guard the other
handlers use, in <commit_sha>.

<!-- pr-autopilot:action=fixed sha=<commit_sha> -->"
```

A top-level comment has no reply endpoint — answer it with a new issue comment that
quotes the line it responds to:

```bash
gh api -X POST "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments" \
  -f body="> <quoted original>

<one or two sentences on what you did and why>

<!-- pr-autopilot:action=fixed sha=<sha> -->"
```

#### GitLab — reply to a discussion

```bash
glab api -X POST \
  "projects/:id/merge_requests/<MR_IID>/discussions/<discussion_id>/notes" \
  -F body="Switched that path to the session.isAdmin guard, in <commit_sha>.

<!-- pr-autopilot:action=fixed sha=<commit_sha> -->"
```

The reply body is `posted(reply, …)` (§0.4, §5.8) — plain prose, humanized,
then unslopped when `--unslop` is on, then exactly one comment view when
`--show-me` is on this run and `show-me` loaded — and MUST end with exactly
one action marker alone on the last line (§0.3). Never unslop the marker
or the view. A comment view is not a reason to reply to an already-handled
thread or to NOISE:

| Marker | Meaning |
|--------|---------|
| `<!-- pr-autopilot:action=fixed sha=<sha> -->` | Code was changed to address the finding |
| `<!-- pr-autopilot:action=refuted -->` | The finding is factually wrong; the reply explains why with code evidence |
| `<!-- pr-autopilot:action=deferred -->` | Acknowledged, not fixed in this PR; the reply explains the follow-up |
| `<!-- pr-autopilot:action=skipped -->` | Allowed only for NITPICKs the author chose to leave alone |
| `<!-- pr-autopilot:action=answered -->` | The comment was a question; the reply answers it, no code changed |

The orchestrator parses these markers to validate that no BLOCKER ended up
`skipped`, and the next iteration parses them to know which threads are already
handled (§5.1). The prose never carries the state — the marker does.

### 5.3 Resolve merge conflicts

**Always check mergeability this round**, even when there is no conflict. Read it
before deciding there is nothing to do:

```bash
# GitHub
gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus
# MERGEABLE / CONFLICTING / UNKNOWN

# GitLab
glab mr view <PR_NUMBER> --output json   # .merge_status / .has_conflicts
```

- `MERGEABLE` → record `conflict: none` and skip the rest of this section.
- `UNKNOWN` → re-check once; if still unknown, treat as `CONFLICTING`.
- `CONFLICTING` → resolve on the **feature branch** — never by rewriting the base,
  never with a blind `--force`.

**Mechanic (no history rewrite, no force-push):**

```bash
git fetch origin
git merge origin/<BASE>          # brings base into the feature branch
# → resolve each conflicted file, then:
git add <resolved files>
git commit --no-edit             # keep the standard merge-commit message
# verification gate (see §5.6) must pass, then:
git push origin <BRANCH>         # normal push — the merge commit fast-forwards cleanly
```

`git merge origin/<BASE>` is the default because it needs no force-push. Only when
the user explicitly asked for a rebased history (`--merge-strategy=rebase`) may the
Author rebase and `git push --force-with-lease origin <BRANCH>` — and **only on the
feature branch, never on a protected/base branch**, never a blind `-f`.

**How to resolve each conflict (in this order — user is the last resort):**

1. **Read the code.** Open both sides of the conflict and the surrounding file.
   Read the git history of the hunk (`git log -L`, `git blame`) to understand why
   each side changed. Prefer the resolution that keeps both intents when they don't
   actually collide.
2. **Consult memory.** If the harness exposes a shared-memory tool (e.g. a
   `supermemory` MCP or similar), search it for prior decisions about the
   conflicting file or rule before guessing — scope the query to the project's
   memory. A recorded past decision outranks a fresh guess.
3. **Escalate on business logic or hard conflicts** (§5.5). If the conflict is not
   an obvious mechanical merge, OR it touches a business rule that must not change,
   STOP and run `groom-me` before resolving. Do not pick a side of a business-rule
   conflict on your own.

If the conflict cannot be resolved safely (business rule unclear and the user is
unreachable in a non-interactive run), do **not** guess. Record it in the response
summary as `conflict: escalated` and halt.

### 5.4 Fix failing CI — attribute first, then act

**Always read check status this round**, even when nothing is red. This is the
existing attribution path, forced to run so a green or pending pipeline is not
mistaken for a skip. External CI stays external — never patch around it.

```bash
# GitHub
gh pr checks <PR_NUMBER> --json name,status,conclusion

# GitLab
glab ci status
```

Then:

- every required check `success`/`neutral` → record `ci: green`. Stop here (no
  fix, no triage comment).
- no required check has a terminal state yet (pending, queued, or none
  registered) → record `ci: not-run`. Do not wait; Phase 5 polls.
- any required check `failure`/`cancelled`/`timed_out` → attribute as below.

A red check is not automatically this PR's fault, and the two possible answers lead
to opposite actions: patch the code, or state on the PR that the pipeline is broken
for an unrelated reason. So the Author decides **who broke it** before it decides
what to do.

**Step 1 — read the failure.**

```bash
# GitHub — pull the failing job logs
gh pr checks <PR_NUMBER> --json name,state,link,workflow
gh run view <run_id> --log-failed        # failing steps of that run

# GitLab
glab ci status
glab ci trace                            # trace the failing job
```

**Step 2 — attribute it**, with evidence, never by vibe:

| Signal | How to check | Reads as |
|--------|--------------|----------|
| The failing file or test is in this PR's diff | `gh pr diff <PR_NUMBER> --name-only` | **PR's fault** |
| The log shows a lint, type, test or build error inside changed code | the log itself | **PR's fault** |
| Snapshot / lockfile / generated artifact drift this PR caused | `git diff` against the failing assertion | **PR's fault** |
| The same job also fails on the base branch | `gh run list --branch <BASE> --workflow "<W>" --limit 5 --json conclusion,headSha,url` | **external** |
| The same job is failing on other open PRs right now | `gh run list --workflow "<W>" --limit 20 --json conclusion,headBranch,url` | **external** |
| Missing/expired secret, 5xx from a registry, DNS or network timeout, runner OOM, rate limit | the log itself | **external** |

Record a verdict per check: `pr`, `external`, or `unknown`. **`unknown` is treated as
`pr`** — the Author investigates its own diff rather than blaming the pipeline. Only
promote a check to `external` when at least one of the external signals above is
backed by a concrete run URL or log line.

**Step 3a — the failure is the PR's fault → fix it.**

1. Identify the root cause from the log (failing test, lint/type error, build break).
2. **Reproduce locally** when the command is obvious from `package.json` /
   `pyproject.toml` / `Makefile` / CI config. Do **not** invent commands.
3. Fix the code (file-scoped). If the fix would change a business rule, escalate
   via `groom-me` first (§5.5).
4. Run the **verification gate** (§5.6) — the fix must not regress lint/types/tests.
5. Commit (`fix(JIRA-XXX): fix CI — <brief>`) and push.
6. Re-poll CI (this is the loop back from Phase 5). Repeat up to `--max-iterations`
   attempts, then escalate to the user with the remaining red checks.

**Step 3b — the failure is external → do not patch around it.** Never make someone
else's breakage go green by weakening a check, pinning a dependency at random, adding
a blind retry, marking a test skipped, or touching the workflow file. Instead, offer
to say so on the PR — in this order:

1. **Check whether it has already been said.** Every CI-triage comment the Author
   posts ends with a machine marker:

   ```
   <!-- pr-autopilot:ci-triage:<check-name> -->
   ```

   Search the existing comments for that marker *before anything else*:

   ```bash
   gh api "repos/$SLUG/issues/$PR/comments" --paginate \
     --jq '.[] | select(.body | contains("pr-autopilot:ci-triage:<check-name>")) | .html_url'
   # GitLab
   glab api "projects/:id/merge_requests/<IID>/notes" --paginate \
     --jq '.[] | select(.body | contains("pr-autopilot:ci-triage:<check-name>")) | .id'
   ```

   A hit → record `ci_triage_comment: already-present` and post nothing. One check,
   one comment, for the life of the PR. Re-run this search every iteration; never
   trust a cached answer from a previous round.

2. **Ask the developer.** Posting on a PR is outward-facing and awkward to retract,
   and "the pipeline is broken, not my PR" is a claim with a social cost. Even when
   the evidence is solid, the Author asks first with `AskUserQuestion`, showing the
   **exact text** it intends to post:

   > CI check `<name>` is red for a reason outside this PR — `<BASE>` fails the same
   > job at `<sha>`. Comment that on the PR?
   > [Post the comment] [Skip, just report it to me]

3. **Only on an explicit yes, post it** as a top-level comment. Run the prose
   through `posted(ci-triage, …)` (§0.4, §5.8) — humanizer, then unslop if
   `--unslop` is on, then exactly one comment view when `--show-me` is on
   this run and `show-me` loaded. Keep the evidence lines, paths, SHAs, and
   the marker verbatim:

   ```markdown
   **CI check `<check-name>` is failing for a reason outside this PR.**

   <what actually breaks, quoting the decisive log line>

   Evidence:
   - `<BASE>` fails the same job at <sha> — <run url>
   - Nothing in this PR's diff is touched by the failing step

   Leaving it alone here — <what needs to happen instead, e.g. "the NPM_TOKEN secret
   needs rotating">.

   <!-- pr-autopilot:ci-triage:<check-name> -->
   ```

   When `--show-me` is on this run and `show-me` loaded, the view sits between
   the prose and that marker. When `--show-me` is off, or the skill is missing,
   the body stays prose + marker. Never HTML.

   Record `ci_triage_comment: posted`. A "no" records `declined` and posts nothing.

4. **Non-interactive or `--auto` → never post.** `--auto` means no prompts, and no
   prompt means no consent, so the comment does not go out. Record
   `ci: escalated`, `ci_triage_comment: not-asked`, put the full diagnosis and the
   drafted comment body in the response summary, and halt.

Either way: never merge over a red required check, and never disable a check to go
green.

### 5.5 Business-logic escalation protocol (`groom-me`)

The Author must **never silently change a business rule.** When acting on a review
comment (§5.2), resolving a conflict (§5.3) or fixing CI (§5.4), if the change would
alter **what the software decides, allows, blocks, or charges** — an
`if`/`else`/`switch`, a guard clause, a validation, an eligibility/pricing/permission/
discount check, a state transition, a threshold or limit, or anything in a
`domain/`/`rules/`/`policy/`/business layer — it STOPS and consults the user **before**
making the change:

1. Invoke the `groom-me` skill (`Skill` tool, `skill: "groom-me"`). It runs a
   short, non-technical interview (one decision per question, via `AskUserQuestion`)
   that confirms the intended behavior in plain language.
2. Apply exactly what the user confirms — nothing assumed, nothing extra.
3. If `groom-me` is unavailable in the harness, fall back to asking the user
   directly with `AskUserQuestion`, framed in the same non-technical way.

A reviewer *asking* for a business-rule change does not authorize it. "This should
also block users over the limit" is a request to change what the software blocks —
the reviewer's comment is the input to `groom-me`, not a substitute for it. If the
user cannot be reached, reply on that comment saying the change needs a product
decision you could not get in this run, and mark it `action=deferred` (§0.3).

In a non-interactive run where the user cannot be reached, a business-logic
comment/conflict/fix is **not** auto-resolved: record it as `escalated` and halt with
a clear pointer to what needs a human decision. Mechanical changes (imports,
lockfiles, formatting, non-behavioral merges and CI fixes) do not need `groom-me` —
do those directly.

### 5.6 Author prompt template

```
You are the Author agent in the pr-autopilot pipeline. You are stateless.

PR: <PR_URL>
Platform: <github|gitlab>
PR number / MR iid: <PR_NUMBER>
Owner/repo (or project_id): <SLUG>
Branch: <BRANCH>  (you must commit and push to this branch)
Base: <BASE>
Iteration: <N>  of <MAX>
Trigger: <pr-feedback | review | ci-fix | inventory>   (why you were spawned this round)
Interactive: <yes|no>   (no ⇒ you may not prompt; escalate instead of asking)
show_me: <true|false>   (this invocation only; do not inherit from an older run)
show_me_comments: <true|false>   (this invocation only; do not inherit from an older run. You do not write the operator briefing.)
Review report: .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md   (present only when Trigger=review)
Repo root: <CWD>
Unslop: <off | on, skill loaded | on, skill missing — humanizer only, do not fake>
Soul login: <login | n/a>
Soul sample: <quoted comments this account already left on this repo | no sample — first person, no invented voice>

You own the whole PR, not just the findings pr-autopilot produced. Make it clean and
MERGEABLE. Do the parts that apply this round, in this order: (A) inventory + triage
every comment on the PR, (B) address the findings, (C) merge conflicts, (D) CI.
(A), (C) and (D) always run this round — including when the Reviewer just approved
and there is nothing to fix. A quiet pass still records `conflict: none` and
`ci: green` or `not-run`. Do not edit the PR description. The orchestrator owns
the PR visual section and the operator briefing (`--show-me-comments`).
Never write `## What this PR does` or the section opener. Do not write an
operator briefing.
When show_me is true this run, each unreplied reply and each posted CI triage
comment gets exactly one comment view (mermaid / file tree / call tree /
markdown diff, never HTML) between the prose and the marker. When show_me is
false, replies stay prose-only. Load `show-me` when the bit is on, for replies
and CI triage only. Finding comment views (when show_me is true) are already
on the Reviewer comments; do not write those.
A thread that already carries a pr-autopilot action marker, or an old status
tag (✅ FIXED / 🛑 REFUTED / ⏸ DEFERRED / 🤷 SKIPPED / 💬 ANSWERED), stays
unanswered — no second reply, no new view. NOISE stays without a reply.

If Trigger=inventory: do (A) only. Write
`.pr-autopilot/<PR_NUMBER>/iter-<N>/pr-feedback.md` and STOP. No code, no
replies, no commit, no push. Skip (B), (C), (D), PUSH, and
`response-summary.md`. The orchestrator will brief from that inventory, then
spawn you again to address findings.

GOLDEN RULE — never silently change a business rule.
Before you act on a comment, resolve a conflict, or write a CI fix that would alter
WHAT the software decides, allows, blocks, or charges (an if/else/switch, a guard, a
validation, an eligibility/pricing/permission/discount check, a state transition, a
threshold or limit, or anything in a domain/rules/policy/business layer), STOP and
confirm the intended behavior with the user FIRST by invoking the `groom-me` skill
(Skill tool, skill: "groom-me"). Apply exactly what they confirm. A reviewer ASKING
for the change does not authorize it — their comment is the input to groom-me, not a
substitute for it. If groom-me is unavailable, ask directly with AskUserQuestion in
the same plain, non-technical language. If Interactive=no, do NOT guess — record it
as `escalated` and halt. Mechanical changes (imports, lockfiles, formatting,
non-behavioral merges/fixes) do not need groom-me.

Before guessing at a conflict resolution, if the harness exposes a shared-memory
tool (e.g. a `supermemory` MCP or similar), search it for a prior decision about
the conflicting file or rule, scoped to the project's memory. A recorded decision
outranks a guess.

──────────────────────────────────────────────────────────────────────────────
HOUSE STYLE — humanize the prose, unslop the voice, ponytail the code (binds everything below)

PROSE. Every reply, comment or PR text you post goes draft → `humanizer` (Skill
tool, skill: "humanizer") → `unslop` if Unslop is on and the skill loaded (Skill
tool, skill: "unslop"). Never post the raw draft. If humanizer is unavailable,
strip the tells yourself: status stamps and emoji openers, rule of three
("cleaner, safer, and easier to maintain"), em dash pile-ups, "not just X but Y",
promotional adjectives (robust, seamless, comprehensive), AI vocabulary (leverage,
delve, crucial, underscore, ensure, streamline), trailing "-ing" analysis
("…, ensuring maintainability"), vague attribution ("best practice suggests"),
filler ("it's worth noting that", "in order to"), generic closers ("Overall this
improves code quality"), and formulaic praise ("Great catch!" every single time).
Write like a teammate: short sentences, name the file and the consequence, no
emoji unless the repo already uses them in its own comments.
If Unslop is on and loaded, write in Soul login's first person using Soul sample.
No sample → first person, no invented pastiche. If Unslop is on but missing, do
not fake it — post the humanizer output. If Unslop is off, skip it.
Never unslop markers, mermaid fences, file trees, call trees, markdown diffs,
paths, SHAs, or command lines. Comment views stay exactly as drafted.
If show_me is true: load `show-me` (Skill tool, skill: "show-me") for **one
comment view per unreplied reply and per posted CI triage comment** from
{mermaid, file tree, call tree, markdown diff}. Never HTML. Put the view after
the prose, before the marker. Never two views. If it cannot load, write prose
+ marker only — do not invent a view, do not emit HTML. The orchestrator will
alert and print the install line. If show_me is false, omit the view.

NEVER STAMP A STATUS. No reply opens with ✅ FIXED / 🛑 REFUTED / ⏸ DEFERRED /
🤷 SKIPPED / 💬 ANSWERED or any label of that shape — that is the loudest signal a
machine wrote it. Say what happened in a sentence, then close the body with exactly
one invisible marker alone on the last line. The marker, not the prose, is the
machine state:
    <!-- pr-autopilot:action=fixed sha=abc1234 -->
    <!-- pr-autopilot:action=refuted -->
    <!-- pr-autopilot:action=deferred -->
    <!-- pr-autopilot:action=skipped -->     (NITPICK only)
    <!-- pr-autopilot:action=answered -->    (QUESTION only)
Never humanize, unslop, translate or reformat a marker. A reply without one gets
re-answered next round. Local artifacts under .pr-autopilot/ are the exception:
they are machine state, keep their uppercase vocabulary, and are never posted.

CODE. Every fix, conflict resolution and CI repair goes through the `ponytail` skill
(Skill tool, skill: "ponytail", falling back to "ponytail:ponytail") first. If it is
unavailable, apply the ladder yourself and stop at the first rung that holds:
does this need to exist at all → does the repo already have it (helper, util, type,
pattern a few files over) → does the stdlib do it → does a native platform feature
cover it → does an already-installed dependency solve it → can it be one line →
only then the minimum code that works.
No abstraction with a single caller, no new dependency for what a few lines do, no
scaffolding for later. Deletion beats addition. Fix the root cause, not the symptom
the comment names: one guard in the shared function beats a guard in every caller —
so grep the other callers before you patch the one the comment points at. Never
refactor beyond what the finding asked for.
Never be lazy about input validation at trust boundaries, error handling that
prevents data loss, security, accessibility, or anything a reviewer explicitly asked
for. And never lazy about understanding the problem: read the whole flow first, then
pick the smallest fix.

──────────────────────────────────────────────────────────────────────────────
(A) INVENTORY + TRIAGE EVERY COMMENT ON THE PR   (always, every round)
Pull ALL of it — human and bot, inline and top-level:
     gh api repos/<SLUG>/pulls/<PR_NUMBER>/comments  --paginate
     gh api repos/<SLUG>/issues/<PR_NUMBER>/comments --paginate
     gh api repos/<SLUG>/pulls/<PR_NUMBER>/reviews   --paginate
     gh api graphql ... pullRequest.reviewThreads { isResolved isOutdated }
     GitLab: glab api projects/:id/merge_requests/<iid>/discussions --paginate

Classify each: CRITIQUE (asks for a change) | QUESTION (wants an answer) |
NOISE (LGTM/praise/bot chatter) | ALREADY_HANDLED (thread resolved, or a reply
already carries a pr-autopilot action marker).

YOUR OWN PAST REPLIES ARE STATE, NOT INPUT. A comment from your own account carrying
a `<!-- pr-autopilot:action=... -->` marker marks that thread ALREADY_HANDLED. Read
them to know what the last round did; never answer them. Replies from older versions
of this pipeline open with a status tag instead (✅ FIXED / 🛑 REFUTED / ⏸ DEFERRED /
🤷 SKIPPED / 💬 ANSWERED) — treat those as handled too.

DEDUPE against review-report.md by comment_id when Trigger=review — a comment in both
sources is ONE work item and ONE reply. Keep the review-report entry.

Assign a severity to external comments: BLOCKER (came from a CHANGES_REQUESTED
review, or names a bug / security hole / data loss / broken contract), SUGGESTION,
NITPICK (or explicitly "nit"/"optional"). Ambiguous ⇒ SUGGESTION. Never downgrade a
CHANGES_REQUESTED finding.

Mark `business_rule: yes|no` per finding WHILE READING — that flag is what routes it
through groom-me in (B).

Write .pr-autopilot/<PR_NUMBER>/iter-<N>/pr-feedback.md with the full inventory
BEFORE touching code.

If Trigger=inventory, STOP here after writing that file. The orchestrator
owns the operator briefing that follows.

──────────────────────────────────────────────────────────────────────────────
(B) ADDRESS THE FINDINGS
Work the inventory in severity order, plus every finding in review-report.md when
Trigger=review (it carries each finding's comment_id).

  BLOCKER    — you MUST address. Either (a) apply a code fix, or (b) if the finding
               is factually wrong, REFUTE it with concrete evidence (cite the code
               that already handles the case). Refusing a BLOCKER without
               refutation is not allowed.
  SUGGESTION — apply if low-risk and within PR scope. Otherwise reply with the
               reason and mark action=deferred.
  NITPICK    — apply only if trivial; otherwise action=skipped is acceptable.
  QUESTION   — answer it; no commit needed.
  business_rule: yes — GOLDEN RULE (groom-me) BEFORE writing any code for it.

Per finding, in order:
1. Make the code change through the ponytail ladder above (file-scoped, smallest
   diff that fixes the root cause; do not introduce unrelated edits).
2. Stage and commit using Conventional Commits + Jira when applicable:
     fix(JIRA-XXX): Address review iter-<N> — <brief>
   Capture the resulting commit SHA.
3. Post an inline REPLY on the corresponding comment. Plain prose through
   `posted(reply, …)` (humanizer, then unslop if Unslop is on, then exactly one
   comment view if show_me is true and `show-me` loaded), with the action
   marker alone on the last line — no status stamp, no emoji opener:
     GitHub (inline comment):
       gh api -X POST repos/<SLUG>/pulls/<PR_NUMBER>/comments/<comment_id>/replies \
         -f body="<one or two sentences on what you did and why>\n\n<optional: snippet of new code>\n\n<!-- pr-autopilot:action=fixed sha=<sha> -->"
     GitHub (top-level comment — no reply endpoint; quote the original):
       gh api -X POST repos/<SLUG>/issues/<PR_NUMBER>/comments \
         -f body="> <quoted original>\n\n<what you did>\n\n<!-- pr-autopilot:action=fixed sha=<sha> -->"
     GitLab:
       glab api -X POST projects/:id/merge_requests/<iid>/discussions/<discussion_id>/notes \
         -F body="<what you did>\n\n<!-- pr-autopilot:action=... -->"

   The \n above must reach the API as REAL newlines — `gh api -f` / `glab api -F`
   do not interpret backslash escapes, and a marker that lands mid-line shows up as
   visible text instead of an HTML comment. Pass a literal multi-line string, or
   read the body from a file: `-F body=@reply.md`.

   Draft the sentence, run it through `humanizer`, then `unslop` if Unslop is on
   and loaded, then — if show_me is true and `show-me` loaded — exactly one
   comment view, then append the marker verbatim (never humanize or unslop the
   marker, the SHA, a code snippet, or the view). If Unslop is on but missing,
   skip it — do not fake the pass. If show_me is true but `show-me` is missing,
   omit the view — do not invent one, do not emit HTML. If show_me is false,
   omit the view. Do not reply (and do not add a view) to an already-handled
   thread or to NOISE. Examples of the sentence:
     fixed    → "Good catch. Swapped the header check for session.isAdmin in abc1234."
     refuted  → "This is already covered: parseLimit clamps to 100 on line 34, so
                 the unbounded case never reaches here."
     deferred → "Agreed, but it is a wider change than this PR should carry. Leaving
                 it out so this one stays reviewable."
     skipped  → "Leaving this one alone. The rest of the file uses the same style."
     answered → "It runs once per request, in the auth middleware, before the
                 handler sees the body."

   Resolve the conversation if the platform supports it and the action is `fixed` or
   `refuted`:
     gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<id>"}){thread{isResolved}}}'
     glab api -X PUT projects/:id/merge_requests/<iid>/discussions/<discussion_id>?resolved=true

──────────────────────────────────────────────────────────────────────────────
(C) MERGE CONFLICTS  (always check this round)
Read mergeability first:
     gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus
     GitLab: glab mr view <PR_NUMBER> --output json
MERGEABLE → record `conflict: none` and skip the rest of (C).
UNKNOWN → re-check once; still unknown ⇒ treat as CONFLICTING.
CONFLICTING → resolve on the FEATURE branch, no history rewrite, no force-push:
     git fetch origin
     git merge origin/<BASE>          # base into feature branch
     # resolve each conflicted file (see the resolution ladder below), then:
     git add <resolved files>
     git commit --no-edit
Resolution ladder (user is the LAST resort):
  1. Read both sides + the file + git history (git log -L / git blame). Keep both
     intents when they don't actually collide.
  2. Consult memory (supermemory, all buckets) for a prior decision.
  3. If the conflict isn't an obvious mechanical merge, OR touches a business rule
     → apply the GOLDEN RULE (groom-me) before picking a side.
Only if the user explicitly chose `--merge-strategy=rebase` may you rebase and
`git push --force-with-lease origin <BRANCH>` — feature branch only, never base,
never a blind `-f`. If a conflict can't be resolved safely and the user is
unreachable, record `conflict: escalated` and halt.

──────────────────────────────────────────────────────────────────────────────
(D) CI  (always read check status this round) — ATTRIBUTE BEFORE ACTING
     gh pr checks <PR_NUMBER> --json name,status,conclusion,state,link,workflow
     gh run view <run_id> --log-failed   # GitHub — failing steps (only if red)
     glab ci status && glab ci trace     # GitLab

All required checks success/neutral → record `ci: green`. Do not patch anything.
No terminal state yet (pending, queued, none registered) → record `ci: not-run`.
Do not wait; Phase 5 polls.
Any required check red → ATTRIBUTE FIRST, then D1–D3.

D1. ATTRIBUTE each red check as `pr`, `external`, or `unknown`, with evidence:
    PR's fault  — the failing file/test is in `gh pr diff --name-only`; the log shows
                  a lint/type/test/build error inside changed code; snapshot or
                  lockfile drift this PR caused.
    external    — the same job fails on <BASE>
                  (gh run list --branch <BASE> --workflow "<W>" --limit 5);
                  the same job fails on other open PRs right now; the log shows a
                  missing/expired secret, a registry 5xx, a network timeout, runner
                  OOM, or a rate limit.
    UNKNOWN COUNTS AS `pr` — investigate your own diff rather than blaming the
    pipeline. Only call a check `external` with a run URL or log line to back it.

D2. `pr` → FIX IT.
    1. Root-cause it from the log.
    2. Reproduce locally when the command is obvious from package.json /
       pyproject.toml / Makefile / CI config. Do NOT invent commands.
    3. Fix the code (file-scoped). Business-rule fix → GOLDEN RULE (groom-me) first.
    4. Run the VERIFICATION GATE (below). Commit `fix(JIRA-XXX): fix CI — <brief>`.

D3. `external` → DO NOT PATCH AROUND IT. Never weaken a check, pin a dependency at
    random, add a blind retry, skip a test, or edit the workflow to go green.
    a) IDEMPOTENCY FIRST — has this already been said on the PR?
         gh api repos/<SLUG>/issues/<PR_NUMBER>/comments --paginate \
           --jq '.[] | select(.body | contains("pr-autopilot:ci-triage:<check-name>")) | .html_url'
       A hit ⇒ record `ci_triage_comment: already-present` and post NOTHING.
       Re-run this search every iteration; never trust a cached answer.
    b) ASK THE DEV — if Interactive=yes, use AskUserQuestion and show the EXACT text
       you intend to post. Never post a "this isn't my PR's fault" comment without an
       explicit yes.
    c) ON YES — post it as a top-level comment via `posted(ci-triage, …)`:
       prose through `humanizer` then `unslop` if Unslop is on and loaded;
       if show_me is true and `show-me` loaded, exactly one comment view
       between prose and marker; evidence lines, paths, SHAs and marker
       verbatim, ending with:
         <!-- pr-autopilot:ci-triage:<check-name> -->
       If Unslop is on but missing, post the humanizer output — do not fake it.
       If show_me is true but `show-me` is missing, omit the view — do not
       invent one, do not emit HTML. If show_me is false, omit the view.
       Record `ci_triage_comment: posted`. A "no" records `declined`.
    d) IF Interactive=no — do NOT post. Record `ci: escalated`,
       `ci_triage_comment: not-asked`, and put the full diagnosis plus the drafted
       comment body in the response summary. Halt.

Never merge over a red required check. Never disable/skip a check to go green.

──────────────────────────────────────────────────────────────────────────────
PUSH
After all applicable parts are done, push the branch:
     git push origin <BRANCH>

VERIFICATION GATE (run BEFORE pushing)
Detect and run, when commands are obvious from package.json / pyproject.toml /
Makefile / etc. Do NOT invent commands.
- lint
- type-check
- tests
If any of them regress vs. the pre-iteration baseline, do NOT push and do NOT post
replies that claim a fix (`action=fixed`). Write a failure record into the response
summary and stop.

OUTPUT
Always fill `conflict` and `ci`. A quiet pass is `conflict: none` and
`ci: green` or `not-run` — never omit the keys.
Write .pr-autopilot/<PR_NUMBER>/iter-<N>/response-summary.md:

---
pr_comments_triaged: <int>
pr_comments_answered: <int>
fixed_count: <int>
deferred_count: <int>
refuted_count: <int>
skipped_count: <int>
conflict: none | resolved | escalated
ci: green | fixed | escalated | not-run
ci_attribution: pr | external | mixed | n/a
ci_triage_comment: posted | already-present | declined | not-asked | n/a
groom_me_consultations: <int>
push_sha: <sha pushed, or "n/a" if not pushed>
verification: pass | fail | partial
---

# Author Response — iteration <N>

## PR feedback triage
- Comments seen: <int> (human <int> / bot <int>)
- Actionable: <int>   Noise: <int>   Already handled: <int>
- Inventory: .pr-autopilot/<PR_NUMBER>/iter-<N>/pr-feedback.md

## Per-finding actions

### [BLOCKER] <title>
- comment_id: <id>            source: <inline | top-level | review-body | review-report>
- author: <login>
- Action: FIXED | REFUTED
- business_rule: yes | no     (yes ⇒ groom-me decision applied: <what the user chose>)
- Commit: <sha or "n/a">
- Reply posted: <reply url or id>
- Notes: <what changed or evidence of refutation>

### [SUGGESTION] <title>
- comment_id: <id>
- Action: FIXED | DEFERRED
- Commit / tech-debt note: ...
- Reply posted: <reply url or id>

(repeat for all findings)

## Conflict resolution
- Status: none | resolved | escalated
- Files: <conflicted paths, or "n/a">
- How resolved: <merge base / rebase>; <groom-me consulted? decision applied>

## CI
- Status: green | fixed | escalated | not-run
- Per check: <name> → attribution: pr | external | unknown → <root cause> → <fix commit | why external>
- Triage comment: posted <url> | already-present <url> | declined | not-asked | n/a
- Drafted comment (when not-asked):
  <the exact body that would have been posted, so the human can post it>

## Verification
- lint: pass | fail | not-run (<reason>)
- type-check: pass | fail | not-run
- tests: pass | fail | not-run
```

### 5.7 Orchestrator post-processing

- Read `response-summary.md` (and `pr-feedback.md` when you need the raw inventory).
- If `verification: fail` → halt, surface logs to user, **do not** loop, **do not** merge.
  Under `--cascade`, this is forest halt (§12.2).
- If `conflict: escalated` or `ci: escalated` → halt and surface exactly what needs a human decision (the Author already consulted `groom-me` where it could). When `ci_triage_comment: not-asked`, print the drafted comment body so the user can post it themselves in one paste. Do **not** merge.
- Validate: every BLOCKER must have `Action: FIXED` or `REFUTED` in `response-summary.md` — the same value its posted reply carries as `action=` in the trailing marker (§0.3). Any BLOCKER with `DEFERRED`/`SKIPPED` → halt and escalate (this is a guardrail violation). This applies to BLOCKERs inferred from external `CHANGES_REQUESTED` reviews exactly as it does to pr-autopilot's own.
- If a human left `CHANGES_REQUESTED` and has not re-reviewed, the PR is not mergeable regardless of CI — never merge past a standing human block.
- **PR visual regenerate.** Only if `--show-me` is on **this run** (`state.json.show_me` was set from that flag in Phase 1, not inherited from an older run) **and** `push_sha` is not `n/a` **and** `git diff <state.head_sha> <push_sha>` is non-empty: fetch the live description, generate a fresh section from the current diff (§3.4), `apply`, update the PR/MR, rewrite `pr-visual.md`, set `head_sha` to `push_sha`, print `PR visual section replaced` (or `appended` if the opener was missing). The orchestrator does this, not the Author. If this run did not pass `--show-me`, or there was no push, or the diff is unchanged, leave the description alone.
- **Do not run `brief()` here.** Operator briefing already ran after inventory when `--show-me-comments` was on this run (§3.7, §5.1). Do not brief after code. Do not post the briefing.
- **Print the resolve outcome.** Whenever `--resolve`/`--auto` ran this invocation, print two lines from `response-summary.md`, even on a quiet pass:
  ```
  [3/6] conflict: none
  [3/6] CI: green
  ```
  Values are `conflict: none|resolved|escalated` and `CI: green|fixed|escalated|not-run`. A skip of those lines is valid only when `--resolve` was off.
- If everything green (verification passed, no `conflict: escalated`, no `ci: escalated`):
  - Another review round is due when `--review`/`--auto` is on, `iteration < MAX_ITERATIONS`, and either the Reviewer verdict this iteration was `CHANGES_REQUESTED` or `push_sha` is not `n/a` → increment iteration, return to **Phase 2**.
  - Otherwise go to **Phase 5**. A quiet Author pass after `APPROVED` (`conflict: none`, `CI: green` or `not-run`, no push) does not re-enter Phase 2. A `--resolve`-only run (no `--review`) always continues to Phase 5 after a successful Author round.
- After `MAX_ITERATIONS` cycles still not APPROVED (or CI still red) → escalate: print summary of remaining BLOCKERs / red checks and ask user how to proceed (extend iterations / abort). Never force a merge past a guardrail.

### 5.8 Comment views on replies and CI triage (`--show-me --resolve`)

A **comment view** on an Author reply or a posted CI triage comment is the same
show-me view as on a Reviewer finding (§4.3). Same four shapes (mermaid, file
tree, call tree, markdown diff). Never HTML. Not the PR visual section. One
view per posted reply, in that reply's body. One view per posted CI triage
comment. The marker stays alone on the last line.

Skip the view when `--show-me` is off **or** `--resolve` is off. `--resolve`
without `--show-me` stays prose-only. `--show-me` without `--resolve` still
does not invent Author replies. `--auto` does not turn `--show-me` on;
`--auto --show-me` does, and because `--auto` already turns on `--resolve`,
unreplied replies and a posted CI triage comment get comment views too.

The PR visual section is unchanged: description only, at most two views,
`apply()` as in §3.4, opener bit-identical. The orchestrator owns it. The
Author still must not rewrite the PR description — never write
`## What this PR does` or the section opener. Regeneration after an Author
push that changed the diff stays the orchestrator's job (§5.7).

**Who writes the view.** The Author prompt includes this run's `--show-me`
bit and, when it is on, loads `show-me` to pick one view per unreplied reply
and per posted CI triage comment. The Author posts through `posted(reply, …)`
and `posted(ci-triage, …)` (§0.4). Finding comment views stay on the Reviewer
comments (§4.3); the Author does not write those.

**When not to reply.** A thread that already carries a pr-autopilot action
marker (or an old status-tag reply: ✅ FIXED / 🛑 REFUTED / ⏸ DEFERRED /
🤷 SKIPPED / 💬 ANSWERED) stays unanswered — no second reply, no new view.
NOISE stays without a reply. A comment view is not a reason to answer either.

**Missing `show-me` skill.** If `--show-me` is on and the Skill tool cannot
load `show-me`: print an alert that names `show-me` and the install line
`npx skills add FelipeOFF/skills --skill=show-me` (once per run, same alert
as §3.4 / §4.3). Do not emit HTML. Do not silently invent comment views.
Post the reply or CI triage as prose + marker. Continue the rest of the
pipeline. The PR visual section still uses the condensed fallback in §3.4.

**`posted(reply) → body`** and **`posted(ci-triage) → body`** — same seam as
§0.4. Done means the examples below hold. Do not run humanizer or unslop a
second time.

```
on(posted_reply)   # same for posted_ci_triage
  return posted(kind, draft, flags)   # §0.4: humanizer, unslop, view, marker
  never rewrite the PR description
```

Format of a view (same as §3.4 / §4.3, one of):

- mermaid → a fenced block with language `mermaid` (flowchart or sequence)
- file tree → indented tree; every path in backticks
- call tree → indented calls; paths in backticks
- markdown diff → a fenced block with language `diff`

File paths in every view go in backticks. Pick the smallest view that makes
*this* reply or triage clear — a swapped session guard is a three-line call
tree, not a map of the repo.

**Examples (completion criterion for posted):**

1. `--show-me --resolve`, unreplied thread → reply is humanized (then unslopped if `--unslop`) + exactly one of the four views + marker last line.
2. `--resolve` without `--show-me` → reply is prose + marker, no view.
3. Already-handled thread (action marker or old ✅/🛑/⏸/🤷/💬 tag) → no second reply, no new view.
4. NOISE → no reply.
5. Posted CI triage under `--show-me` → exactly one view, `<!-- pr-autopilot:ci-triage:<check-name> -->` last line.
6. `--show-me` on, skill missing → alert + npx; reply/CI posted without view, no HTML.
7. Author never writes `## What this PR does` / section opener.

Posted shape when `--show-me --resolve` and the skill loaded:

```markdown
Good catch. Swapped the header check for `session.isAdmin` in abc1234.

checkout
  requireAdmin
    session.isAdmin

<!-- pr-autopilot:action=fixed sha=abc1234 -->
```

Without `--show-me`, that same reply is the prose and the marker, nothing in
between.

Posted CI triage under `--show-me` (skill loaded):

```markdown
**CI check `e2e` is failing for a reason outside this PR.**

The same job fails on `main` at 77f2a1c. Nothing in this PR's diff is
touched by the failing step.

e2e
  checkout
    npm test

<!-- pr-autopilot:ci-triage:e2e -->
```

---

## 6. Phase 5 — CI Polling

Runs when `--resolve`, `--merge`, or `--auto` is set — to drive CI green (resolve)
and/or to merge. A review-only run (`--review` alone) never reaches this phase.

```bash
# GitHub
gh pr checks <PR_NUMBER> --json name,status,conclusion

# GitLab
glab mr ci <PR_NUMBER>
# or: glab api projects/:id/merge_requests/<iid>/pipelines
```

### Polling rules

- Initial wait: 15s (let webhooks register).
- Poll every `CI_POLL_INTERVAL` seconds.
- After 10 polls with no terminal state, back off to 60s.
- Hard stop at `CI_TIMEOUT` seconds → ask user (or, in `--auto` mode without a TTY, halt with a clear "CI timeout" message and exit non-zero).
- Terminal states:
  - **All required checks `success`/`neutral`** → proceed to **Phase 6** (merge) if `--merge`/`--auto` **and this is not a cascade ship or reuse** (cascade Phase 6 is `land`, §12.2), otherwise STOP and print the green PR URL. Under `--cascade`, return to `advance` / `land` instead of merging into a still-open parent.
  - Any `failure`/`cancelled`/`timed_out`:
    - **`--resolve`/`--auto` on** → loop back to **Phase 3** with `Trigger=ci-fix`. The Author first **attributes** the failure (§5.4): a failure this PR caused gets fixed (escalating business-logic fixes via `groom-me`), pushed, and re-polled; a failure that predates the PR is never patched around — the Author asks the developer before saying so on the PR, and stays quiet in a non-interactive run. Bounded by `--max-iterations` CI-fix attempts; after that, surface the remaining red checks and escalate to the user. **Never merge over a red check.**
    - **otherwise** → fetch failing job logs (`gh run view --log-failed` or `glab ci trace`), surface the last ~80 lines, **stop**. Do not retry automatically. **Never merge.**
  - Mix of pending + success → keep polling. **Never merge while any required check is still pending or queued.**

`--auto` does not relax any of these rules — its effect is to skip
human-confirmation prompts and to let the Author fix red CI (above). The merge
step in Phase 6 is gated on:
1. `--merge` or `--auto` is set (merge was requested)
2. `verdict: APPROVED` (when `--review` ran) — if review was off, this gate is N/A
3. Every required check returned a non-failing terminal state
4. `mergeable=MERGEABLE` (no conflicts, branch protection satisfied)

If any applicable gate is missing, halt with the failing condition (no merge).

### Mergeability check (must also pass)

```bash
# GitHub
gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus
# states: MERGEABLE / CONFLICTING / UNKNOWN
```

`CONFLICTING`:
- **`--resolve`/`--auto` on** → loop back to **Phase 3** so the Author resolves the
  conflict on the feature branch (merge base in, §5.3), consulting `groom-me` for
  any business-rule conflict. Re-check mergeability afterward.
- **otherwise** → stop, ask the user to resolve. Do not attempt auto-rebase.

---

## 7. Phase 6 — Merge

Runs **only** when `--merge` or `--auto` is set (and never when `--draft`). Without
one of those, the pipeline has already stopped before this phase.

Under `--cascade`, this phase runs from `land` (§12.2), not from a
graph-mode **ship** into a still-open parent. `--cascade` does not
turn merge on. `--draft` still forbids merge. A standing human
`CHANGES_REQUESTED` still blocks merge of that PR (§5.7). Never
force-push the trunk.

```bash
# GitHub
case "$MERGE_STRATEGY" in
  squash)  gh pr merge <PR_NUMBER> --squash --delete-branch ;;
  merge)   gh pr merge <PR_NUMBER> --merge  --delete-branch ;;
  rebase)  gh pr merge <PR_NUMBER> --rebase --delete-branch ;;
esac

# GitLab
glab mr merge <PR_NUMBER> \
  $([ "$MERGE_STRATEGY" = "squash" ] && echo "--squash") \
  --remove-source-branch --yes
```

Merge only when `--merge`/`--auto` is set; always skip if `--draft`. Update `state.json` to `merged` and report PR URL + merge SHA to the user.

---

## 8. Error & Edge Cases

| Situation | Action |
|-----------|--------|
| PR already exists | Reuse PR number, skip creation. If `--show-me`, still run §3.4 on the live description |
| Cascade work item already has an open PR | Reuse that PR. Do not open a second. Restack onto the parent head or trunk if the base is wrong (§12.2) |
| Cascade verification fail | Halt the forest. Do not start the next item. Independent later roots stay pending. Tree lists opened / failed / pending |
| Cascade `--review` without `--resolve`, BLOCKER | Same halt as verification fail |
| Cascade requested stages of current unfinished | Do not start the next work item |
| `--show-me` and `show-me` skill missing | Alert once naming `show-me` plus `npx skills add FelipeOFF/skills --skill=show-me`. PR visual section still uses the condensed fallback in §3.4. No HTML. No silent fake comment views. Pipeline continues |
| `--show-me-comments` and `show-me` skill missing | Same alert + npx line as `--show-me`. Skip the operator briefing. Do not fake views. Do not post anything as a briefing. Pipeline continues |
| `--unslop` and `unslop` skill missing | Alert that names `unslop` and `npx skills add https://github.com/cursor/plugins --skill=unslop`. Do not fake the pass. Continue; posted prose stays humanizer-only |
| `--show-me --review` | Each Reviewer finding (code + test track) gets exactly one comment view (§4.3). Marker last line. PR visual section unchanged |
| `--review` without `--show-me` | Findings stay prose-only. No comment view |
| `--show-me` without `--review` and without `--resolve` | PR visual section only. No new review, no comment views |
| `--show-me --resolve` | Each unreplied reply gets exactly one comment view; a posted CI triage comment gets exactly one (§5.8). Marker last line. Already-handled threads (action marker or old status tag): no second reply, no new view. NOISE: no reply. Author does not write the PR visual section |
| `--resolve` without `--show-me` | Replies stay prose-only. No comment view |
| `--show-me-comments` without `--resolve` and without `--review` | Fetch comments already on the PR, print operator briefing (§3.7), STOP. No Author. No new posts. Under `--cascade` graph, brief that PR and continue |
| `--show-me-comments --review` without `--resolve` | Phase 2 posts the review, then brief (including those findings), STOP. No Author. Under `--cascade` graph, brief that PR and continue |
| `--cascade --show-me-comments` without `--resolve` | Compose onto each graph ship (same as `--show-me`). Brief that PR's comments; continue to the next work item. Do not STOP the forest |
| `--show-me-comments --resolve` | Brief after inventory (`pr-feedback.md`), before the Author touches code. Do not brief after the push |
| `--auto --show-me-comments` or no TTY | Write `.pr-autopilot/<PR>/operator-briefing.md`. Do not prompt. Continue the rest of the pipeline |
| `--auto` without `--show-me-comments` | No operator briefing |
| Operator briefing | Never posted to the PR. Never HTML. Inline comments include `path:line`; top-level comments do not invent a path |
| `--auto` without `--cascade` / no cascade phrase | Not cascade. One PR from the current branch. No forest |
| `--cascade` (or "cascade these tickets") | `plan` then `advance` (§12). Graph mode: do not start Phase 1 on the current branch. Existing-chain: walk the current PR |
| `--cascade` and `cascade-flow` missing | Alert + `npx skills add FelipeOFF/skills --skill=cascade-flow`. Condensed fallback in §12.3. PR still opens |
| Cascade graph mode `--title` / `--body` | Not stamped onto the work-item PR. Title and body come from the work item |
| Cascade existing-chain `--title` / `--body` | Apply to the current PR only. Not to ancestors or siblings |
| `ready-for-human`, id not named | Skip. Do not implement. Do not open a PR |
| Spec/epic in this ticket's happy path | Not a PR |
| Spec/epic id only, interactive | Ask once: children vs one PR. Do not ship until answered |
| Spec/epic id only, `--auto` or no TTY | Halt. Do not guess. Do not ship |
| Origin GitHub, global Jira MCP, no `PROJ-*` | GitHub source. No Jira question |
| Origin GitLab | GitLab issues are the source |
| `.beads/` present | Beads are a detected source |
| Prompt `PROJ-12` | Jira source, no question |
| Prompt `#9` | GitHub source (GitLab if origin is GitLab), no question |
| Prompt is a `bd` id or a Cairn ticket | Beads source, no question. Cairn is not a fourth tracker |
| Two sources in this repo, no ids | Ask once which graph (halt if `--auto` / no TTY) |
| Zero sources, current PR on the trunk | Ask once which work items (halt if `--auto` / no TTY) |
| Tracker config file | Do not add one. Source is this repo or the IDs in the prompt |
| `--cascade` while on `main`/`master` | Allowed in graph mode: cut a new branch from trunk or the parent head. Do not abort preflight on the current branch |
| Several unblocked work items | One PR per item, each targeting the trunk. Do not invent a line |
| Work item blocked by another in `items` | Child PR base is the parent head, not the trunk. Do not start the child until the parent PR exists |
| Child PR body | `Stacked on: #<parent> (merge after)` plus `Closes #<child>`. Do not close the spec |
| IDs in the prompt, current PR stacked | Graph mode. IDs win. Do not walk the existing chain |
| No IDs, current PR base ≠ trunk | Existing-chain. Path is trunk → … → current PR. Not graph |
| Sibling stacked on the same parent | Not on the path. Not on the short tree. Not merged |
| `--cascade` without `--merge` / `--auto` | Forest or chain opens (or is walked). None merge |
| `--cascade --merge` / `--cascade --auto` | `land` bottom-up: root into the trunk first, then the next PR. Graph: child retargeted if it still pointed at the old head. Existing-chain: ancestors plus current; siblings stay open |
| Dangling child | Retarget trunk, `git merge` trunk into the feature (no force-push), re-verify — even when `--merge` is off. Host merge of that PR still only with `--merge` / `--auto` |
| `--cascade --draft --merge` | PRs may open as draft. None merge |
| Existing-chain `--merge` / `--auto` | Walk the path. `land` ancestors then current. Siblings stay |
| Existing-chain `--review` / `--resolve` / `--show-me` / `--show-me-comments` / `--unslop` | Current PR only. Not ancestors. Not siblings |
| No current PR, or current PR already on the trunk, no IDs | Not existing-chain. Fall through in `plan` |
| Graph mode current feature branch | Ignored. Not the parent and not the base |
| `--show-me` Author round with no push or unchanged diff | Leave the description alone |
| `--resolve` / `--auto` without `--show-me` | Never write a PR visual section. Never write a comment view |
| `--auto` without `--unslop` | Never run the unslop pass |
| Reviewer `APPROVED`, `--resolve`/`--auto` on | Phase 3 still runs. Inventory, conflict check, CI attribution. Terminal prints `conflict:` and `CI:` even on a quiet pass |
| `--review` without `--resolve` | STOP after Phase 2. No Author. No `conflict:` / `CI:` lines from resolve |
| Working tree dirty | Ask user to commit; do not auto-stash |
| Push rejected (non-fast-forward) | Stop, ask user — do not force-push |
| Author agent breaks lint/tests | Halt loop, surface logs |
| Reviewer never approves (max iter hit) | Escalate with remaining BLOCKERs summary |
| CI fails, `--resolve`/`--auto` on | Author attributes it first (§5.4). `pr` → fix, re-poll, escalate after `--max-iterations`. `external` → never patch around it |
| CI fails for reasons outside the PR | Ask the dev (`AskUserQuestion`) before commenting that on the PR; check the `<!-- pr-autopilot:ci-triage:<check> -->` marker first so it is said once, never twice |
| CI fails externally, non-interactive/`--auto` | Do **not** comment — no prompt means no consent. Record `ci: escalated`, `ci_triage_comment: not-asked`, print the drafted body for the human to post |
| CI fails, resolve off | Surface failing job logs, stop |
| PR has comments from humans or other bots | Author triages all of them (§5.1), inline and top-level, with the same severity rules as its own findings |
| Author's own earlier replies on the PR | Read as state (what round N-1 did), never re-answered — a reply carrying an `<!-- pr-autopilot:action=... -->` marker marks its thread `ALREADY_HANDLED`; replies from older versions carry a leading status tag instead and count the same |
| A reviewer asks for a business-rule change | The request is input to `groom-me`, not authorization. Confirm with the user first; reply saying it needs a product decision and mark `action=deferred` if unreachable |
| Human left `CHANGES_REQUESTED` and hasn't re-reviewed | Never merge, no matter how green CI is |
| Merge conflict, `--resolve`/`--auto` on | Author resolves on the feature branch (merge base in, §5.3); business-rule conflicts go through `groom-me` first |
| Merge conflict, resolve off | Stop, ask user — do not auto-resolve |
| Conflict/CI fix would change a business rule | Consult the user via the `groom-me` skill before changing it; in a non-interactive run, record `escalated` and halt |
| Business-rule conflict, user unreachable | Do not guess — record `escalated`, halt with what needs a human decision |
| Required reviewers / branch protection blocks merge | Stop, surface the rule that blocks |
| `gh`/`glab` not installed | Abort preflight with install hint |
| Detached HEAD | Abort preflight |
| Remote is neither GitHub nor GitLab | Abort preflight |
| Unsigned commit rejected by hook | Surface hook output, do not retry with `--no-verify` |
| Subagent returns malformed artifact | Retry once with explicit format reminder, then escalate |

**Never** use `--no-verify` or a blind `--force`/`-f`. Conflict resolution merges
the base into the feature branch (no history rewrite); the only force allowed is
`--force-with-lease` on the **feature** branch when the user explicitly chose
`--merge-strategy=rebase` — never on a protected/base branch. **Never** silently
skip a BLOCKER, and **never** silently change a business rule — `groom-me` first.

---

## 9. State & Artifacts

Layout under `.pr-autopilot/<PR_NUMBER>/`:

```
state.json                       # {iteration, status, pr_url, platform, started_at, show_me, show_me_comments, unslop, cascade, head_sha}
pr-visual.md                     # last applied PR visual section (absent when --show-me is off)
operator-briefing.md             # operator briefing when --show-me-comments and (--auto or no TTY)
iter-1/review-report.md          # merged findings from code + test tracks
                                 # (absent when --resolve runs without --review)
iter-1/test-ranker-a.md          # test ranker 1 output (only when tests in diff)
iter-1/test-ranker-b.md          # test ranker 2 output (only when tests in diff)
iter-1/test-consolidated.md      # consolidator output (only when tests in diff)
iter-1/pr-feedback.md            # inventory of every comment already on the PR
iter-1/response-summary.md
iter-2/review-report.md
iter-2/test-ranker-a.md
iter-2/test-ranker-b.md
iter-2/test-consolidated.md
iter-2/pr-feedback.md
iter-2/response-summary.md
ci/last-poll.json
merge.json                       # post-merge metadata
```

Under `--cascade`, also `.pr-autopilot/cascade/` (this invocation; do not
inherit `cascade: true`):

```
plan.md                          # typed forest or chain plan (front-matter + items or path)
state.json                       # {cascade, mode, trunk, source, items, path, last_result}
```

`state.json.status` transitions:
`created → reviewing → triaging_feedback → responding → resolving_conflict → fixing_ci → ci_pending → merging → merged`
or any → `stopped` (PR-only / review-only run finished as intended)
or any → `escalated` with `reason` (needs a human decision, e.g. a business-rule conflict)
or any → `aborted` with `reason`.

Re-running the skill on the same branch reads state and resumes at the correct phase.

---

## 10. Invocation Examples

```
# Default (no flags): open the PR and stop
pr-autopilot

# Fully autonomous: review + resolve (comments + conflicts + CI) + wait CI + merge
pr-autopilot --auto

# Open PR + auto-merge on green CI, no review
pr-autopilot --merge

# Open PR, post inline review, stop (human will resolve)
pr-autopilot --review

# Work the feedback a PR ALREADY has (teammates, Copilot, CodeRabbit) + conflicts
# + CI, without posting a new AI review
pr-autopilot --resolve

# Post a review first, then Author runs even if that review is APPROVED
pr-autopilot --review --resolve

# Resolve existing feedback + merge on green CI
pr-autopilot --resolve --merge

# Auto mode with tighter loop and rebase merge
pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
pr-autopilot --draft

# Override base branch
pr-autopilot --merge --base=develop

# Reviewer briefing on the PR description (opt-in; --auto does not imply this)
pr-autopilot --show-me

# Briefing on the description, plus one comment view on each Reviewer finding
pr-autopilot --show-me --review

# Briefing on create; one comment view on each unreplied reply and on a
# posted CI triage comment; regenerate the section after Author fixes that
# change the diff
pr-autopilot --show-me --resolve

# Full hands-off plus the briefing (and comment views on findings, unreplied
# replies, and a posted CI triage comment, because --auto already turns on
# --review and --resolve)
pr-autopilot --auto --show-me

# Operator briefing of comments already on the PR (opt-in; --auto does not imply this)
pr-autopilot --show-me-comments

# Review, then brief those findings plus whatever was already on the PR, then stop
pr-autopilot --show-me-comments --review

# Brief after inventory, then Author addresses the findings
pr-autopilot --show-me-comments --resolve

# Full hands-off: write .pr-autopilot/<PR>/operator-briefing.md and continue
pr-autopilot --auto --show-me-comments

# Second prose pass after humanizer (--auto does not imply this)
pr-autopilot --unslop

# Unslop Reviewer finding bodies
pr-autopilot --unslop --review

# Unslop Author replies (and a posted CI triage comment)
pr-autopilot --unslop --resolve

# Full hands-off plus unslop on every posted prose surface auto already writes
pr-autopilot --auto --unslop

# Compose: unslop on title/body, findings, and replies
pr-autopilot --review --resolve --unslop

# Cascade (opt-in; --auto does not imply this): pick source from this
# repo or IDs, then a forest of work items. Independent items are roots
# against the trunk. A blocked child stacks on the parent head. Reuse
# an open work-item PR; halt the forest on failure. No IDs and current
# PR stacked: existing-chain (path to this PR).
pr-autopilot --cascade

# Same flag via a phrase
# cascade these tickets

# Named IDs: graph mode even if the current PR is stacked
pr-autopilot --cascade #9 #10 #11 #12
pr-autopilot --cascade PROJ-12

# No IDs, current PR stacked on another PR: existing-chain.
# Walks trunk → … → this PR. Siblings stay off the path. No merge
# unless --merge / --auto.
pr-autopilot --cascade

# Bottom-up merge: root into the trunk first, then the next PR
pr-autopilot --cascade --merge

# Existing-chain merge: ancestors plus current; siblings stay
pr-autopilot --cascade --merge

# Drafts may open; none merge
pr-autopilot --cascade --draft --merge

# Compose review / visual / comments / draft onto each shipped PR (still no merge)
pr-autopilot --cascade --review --show-me --show-me-comments --draft

# Trunk is develop
pr-autopilot --cascade --base=develop
```

---

## 11. Output to User

Keep terminal output terse. Per phase, emit one line:

```
[mode] --auto (full hands-off)
[unslop] skill missing — npx skills add https://github.com/cursor/plugins --skill=unslop
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[1/6] PR visual section appended
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 inline comments posted
[3/6] Author iter 1   → triaged 12 comments (7 actionable, 3 noise, 2 already handled)
[3/6] Author iter 1   → 2 fixed, 1 deferred, 1 answered, replies posted, pushed abc1234
[3/6] PR visual section replaced
[3/6] Author iter 1   → conflict in `pricing.ts` resolved (merged base, groom-me confirmed) def5678
[3/6] conflict: resolved
[3/6] CI: not-run
[2/6] Reviewer iter 2 → APPROVED
[3/6] Author iter 2   → triaged 12 comments (0 actionable, 3 noise, 9 already handled)
[3/6] conflict: none
[3/6] CI: green
[5/6] CI: waiting… 2/4 pending
[5/6] CI: `unit` failed → attributed to this PR → flaky assert corrected, pushed 9ab0cd1
[5/6] CI: `e2e` failed → attributed to main (fails at 77f2a1c too) → asked, comment posted
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ ef01234
```

Whenever `--resolve` ran, the Author round **always** prints a conflict line
(`none` / `resolved` / `escalated`) and a CI line (`green` / `fixed` /
`escalated` / `not-run`), even on a quiet pass. A skip of those two lines is
valid only when `--resolve` was off.

Quiet pass after APPROVED (`--review --resolve`):

```
[mode] --review --resolve
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → APPROVED
[3/6] Author iter 1   → triaged 4 comments (0 actionable, 2 noise, 2 already handled)
[3/6] conflict: none
[3/6] CI: green
[5/6] CI: 4/4 checks green
```

The `[mode]` line reflects the flags in play — e.g. `PR only (no flags)`,
`--merge`, `--review`, `--resolve`, `--show-me-comments`, `--unslop`,
`--cascade`, or `--auto (full hands-off)`.
Phases that don't run for the chosen mode are simply absent from the output —
except the conflict and CI lines, which are never absent when `--resolve` ran.

On a `--show-me` or `--show-me-comments` run where `show-me` cannot load, also
print (once):

```
[1/6] show-me skill missing — skipped comment views. npx skills add FelipeOFF/skills --skill=show-me
```

The PR visual section still uses the §3.4 fallback. The operator briefing is
skipped (do not fake views). The rest of the pipeline continues.
The `[unslop] skill missing` line prints only when `--unslop` is on and the
skill cannot load; the rest of the pipeline continues.

On a `--show-me-comments` run with the skill loaded, print the briefing in the
harness (or a one-liner pointing at the artifact when `--auto` or no TTY),
then a count line:

```
[1/6] operator briefing → 3 comments (2 inline, 1 top-level)
```

```
[1/6] operator briefing written → .pr-autopilot/482/operator-briefing.md
```

`--show-me-comments` without `--resolve` (after the review, if `--review` also
ran) then STOPs on a single-PR run. Under `--cascade` graph, brief that PR
and continue to the next work item. With `--resolve`, that count line prints
after inventory and before the Author addresses findings.

Quiet operator-briefing-only run (`--show-me-comments` on an existing PR):

```
[mode] --show-me-comments
[1/6] PR #482 reused → https://github.com/acme/api/pull/482
`src/foo.ts:42`
> checkout still calls chargeCard after reserveInventory fails

checkout
  reserveInventory
    chargeCard

> does this handle the empty cart?

cart.ts
  checkout
    empty → return

[1/6] operator briefing → 2 comments (1 inline, 1 top-level)
```

When `--cascade` is on, print the short tree (§12.4) as well — not the
cascade-flow `--full` dashboard. Example:

```
[mode] --cascade
[cascade] graph  trunk=main  source=github
[cascade] cascade-flow skill missing — npx skills add FelipeOFF/skills --skill=cascade-flow
main
└→ #9 [opened] PR #40  Closes #9
└→ #10 [opened] PR #41  Closes #10
└→ #11 [opened] PR #42  Closes #11
   └→ #12 [opened] PR #43  Closes #12  Stacked on: #11
[1/6] PR #43 created → https://github.com/acme/api/pull/43
```

Existing-chain (no IDs, current PR `#12` stacked on `#11`, sibling
`#13` also on `#11`) prints the path, not the sibling:

```
[mode] --cascade
[cascade] existing-chain  trunk=main
main
└→ #11 [opened]
   └→ #12 [opened]  (current)
```

`--cascade --merge` lands bottom-up. After the parent merges, a child
still on the old head is retargeted:

```
[mode] --cascade --merge
[cascade] graph  trunk=main  source=github
main
└→ #11 [merged] PR #42  Closes #11
   └→ #12 [merged] PR #43  Closes #12  retargeted → main
[6/6] Merged (squash) → main @ ab12cd3
```

`--cascade` alone does not print a merge line. `--cascade --draft --merge`
opens drafts and prints no merge.

A cascade ask that `--auto` (or no TTY) cannot make prints the question
and halts:

```
[cascade] halt: spec #16 only — children vs one PR? (--auto, no guess)
[cascade] halt: two sources (github, beads) — which graph? (--auto, no guess)
[cascade] halt: zero sources — which work items? (--auto, no guess)
```

A reused PR (restacked when the base was wrong):

```
[mode] --cascade
[cascade] graph  trunk=main  source=github
main
└→ #9 [opened] PR #40 reused  restacked → main  Closes #9
[1/6] PR #40 reused → https://github.com/acme/api/pull/40
```

A forest halt (verification fail, or `--review` without `--resolve` and
a BLOCKER). Independent later roots stay pending:

```
[mode] --cascade
[cascade] graph  trunk=main  source=github
main
└→ #9 [failed] PR #40  Closes #9
└→ #10 [pending]
└→ #11 [pending]
   └→ #12 [pending]
[cascade] halt: #9 verification fail — forest stopped. #10 not started (v1 serial)
```

On any halt, print: phase, reason, the artifact path the user should inspect, and 1–2 suggested next actions. On an `escalated` halt (business-rule conflict / unfixable CI), name exactly what needs a human decision.

---

## 12. Cascade (`--cascade`)

`--cascade` wraps the existing pipeline. It does not replace phases 1–6
and it does not turn `--merge` on. `--auto` does not turn `--cascade` on.
Record `cascade` in run state from **this invocation** only — do not inherit
`true` from a previous run.

When the flag is off, this section does not run. Start at Phase 1 on the
current branch.

When the flag is on, do **not** start Phase 1 on the current branch as a
graph-mode ship. Run `plan`, then loop `advance` until `done` (or a
halt/ask).

**Graph mode** (IDs or "these tickets"): each **ship** is the requested
stages on that work item, with host base = parent head or trunk.
Phase 6 is not part of the ship — `land` merges after the path is
opened. An open work-item PR is **reused** — restack its base if
wrong; do not open a second PR. A failed ship **halts** the forest:
the next item does not start.

**Existing-chain mode** (no IDs, current PR base ≠ trunk): `plan` walks
trunk → … → current PR. Siblings stay off the path. `advance` prints
that path. It does not open new PRs. With `--merge` or `--auto`,
`land` merges that path bottom-up (ancestors plus current, not
siblings). Without those flags, it does not merge.

A **work item**: a GitHub or GitLab issue, a bead, or a Jira issue,
labelled `ready-for-agent`, with a parent or a task type. A spec/epic
is the container — it does not get a PR unless the spec-only ask
answers "one PR". `ready-for-human` is skipped unless that ID was
named.

**Trunk.** `--base` if passed, else the repo default branch:

```bash
# GitHub
gh repo view --json defaultBranchRef -q .defaultBranchRef.name

# GitLab
glab api projects/:id --jq .default_branch
```

**Graph mode** ignores the current feature branch. IDs or a phrase like
"these tickets" select it, **even if the current PR is stacked** (base ≠
trunk). Do not enter existing-chain when the prompt named IDs.

**Existing-chain mode** is `--cascade` with no work-item IDs and no
"these tickets" phrase, when an open PR for the current branch has
base ≠ trunk. The path is that PR plus its ancestor PRs, trunk-first.
A sibling stacked on the same parent is not on the path. A descendant
stacked on the current PR is not on the path. No current PR, or the
current PR already targets the trunk → not this mode.

**Forest.** Independent work items are roots against the trunk. A child
stacks only when the graph records a blocker (`## Blocked by` in the
issue body, or an open native blocking issue). Do not order independent
items into a line. The spec/epic parent is the container, not a stacking
parent. v1 is serial: roots first (tie-break: id number); a child starts
only after the parent PR exists. One worktree at a time. A failed work
item stops the forest — independent later roots are not started.

**Source** is this repo, or the IDs in the prompt. A globally installed
MCP is not a source. Cairn tickets are beads, not a fourth tracker.
Do not add a tracker config file.

### 12.1 `plan(invocation, repo, current_pr)`

`plan` is the seam. Done means the examples in §12.5 hold.

```
on(source)
  detected = []
  origin is GitHub     → +github
  origin is GitLab     → +gitlab
  .beads/ exists       → +beads
  this repo has a Jira project → +jira
    # a Jira project key bound to this repo (this workspace's Jira
    # tool configured for this repo, or the repo's own documented
    # project key). A Jira MCP installed globally is not enough.
  Cairn tickets        → beads (never a separate tracker)
  never: Linear, Asana, mixed graphs, MCP-as-detection
  never write a tracker config file

  ids in the prompt pick the source without asking:
    #N            → github (origin GitHub) or gitlab (origin GitLab)
    PROJ-123      → jira
    bd id         → beads
    Cairn ticket  → beads
    two trackers named → ask once (halt if --auto / no TTY)

  no disambiguating ids:
    one detected  → that source
    two+ detected → ask which graph (halt if --auto / no TTY)
    zero detected → fall through in plan

on(plan)
  cascade off → not this feature
  IDs or "these tickets" → mode=graph, source=pick(repo, ids),
                           items=forest(source, ids)
    IDs win even if current PR base ≠ trunk
    ignore current feature branch
    spec-only id → ask children vs one PR
                   (halt if --auto / no TTY)
  else if current PR is open and current PR base ≠ trunk
    → mode=existing-chain
      path=existing_chain_path(current_pr, trunk)
      siblings stay off the path
  else if two+ sources without ids → ask which graph
                                     (halt if --auto / no TTY)
  else → ask which work items
         (halt if --auto / no TTY)

on(existing_chain_path)
  # Host PRs/MRs, not work-item IDs. GitHub and GitLab both walk.
  current = open PR/MR for this branch
  if none or current.base == trunk → not this mode
  open = all open PRs/MRs on this repo   # number, head, base
  path = []
  cursor = current
  seen = {}
  loop
    if cursor.number in seen → halt (cycle)
    seen += cursor.number
    prepend cursor to path
    if cursor.base == trunk → break
    parent = the open PR/MR whose head == cursor.base
    if none → break   # dangling child; land() retargets at the trunk
    if several → pick lowest number
    cursor = parent
  siblings = open PRs whose base equals some path node's base
             and whose number is not on the path
  descendants = open PRs whose base equals current.head
  siblings and descendants stay off the path
  return path   # trunk-side first, current last
```

**Existing-chain host PRs** (mode=existing-chain). Walk the PR/MR
graph, not the tracker. Do not ask which source.

```bash
# GitHub — current PR, then every open PR (head / base)
gh pr view --json number,url,baseRefName,headRefName,state,title
gh pr list --state open --limit 1000 \
  --json number,url,baseRefName,headRefName,title

# GitLab — current MR, then every open MR
glab mr view --output json
# .iid .source_branch .target_branch .state .title .web_url
glab mr list --state opened --per-page 100 --output json
```

`base` is `baseRefName` / `target_branch`. `head` is `headRefName` /
`source_branch`. Trunk is `--base` or the repo default, same as graph
mode. No open PR for this branch → not existing-chain.

**Ask once.** Interactive: one question, then continue from the answer.
`--auto` or no TTY: print the question, halt, do not guess, do not ship.

- spec-only id → children of `<id>`, or one PR for the spec?
- two+ sources, no ids → which graph: `<a>` or `<b>`?
- zero sources, or one source without ids and the current PR already
  on the trunk → which work items?

A spec-only prompt is **only** that spec/epic id: no child ids, no
"these tickets". "these tickets" plus a parent spec is graph mode on
the children, not this ask. Answering "one PR" ships the spec as the
one work item. Answering "children" sets `items` to the ready-for-agent
children (forest + stacking as above).

**Parse the flag** like `--review`: `--cascade` or `--cascade=true` is on;
`--cascade=false` cancels a phrase. A **clear cascade phrase** also sets
it (case-insensitive): "cascade these tickets", "cascade those issues",
"cascade the work items", "cascade this", "run a cascade". `--auto` is
not a cascade phrase. cascade-flow `--full` / a panorama is not a
cascade phrase.

**Items** — same ready-for-agent / parent-or-task / skip ready-for-human
/ unblocked rules on every source.

**GitHub items** (source=github). A global Jira MCP is not a source:

```bash
# Named id (blockedBy / blocking are native issue dependencies)
gh issue view <N> --json number,title,body,labels,state,url,blockedBy,blocking

# Labels, parent, type, native blockers
gh api graphql -f query='
  query($owner:String!, $repo:String!, $n:Int!) {
    repository(owner:$owner, name:$repo) {
      issue(number:$n) {
        number title state
        issueType { name }
        parent { number title }
        labels(first:20) { nodes { name } }
        blockedBy(first:20) { nodes { number title state } }
      }
    }
  }'
```

**GitLab items** (source=gitlab):

```bash
glab issue view <N>
glab api "projects/:id/issues/<iid>"
# labels, epic/parent, issue_links (blocks)
```

**Beads items** (source=beads; `.beads/` present). Cairn tickets use
this path — do not treat Cairn as a fourth tracker:

```bash
test -d .beads
bd show <id> --json
bd ready --json
bd dep tree <id>
bd dep <id>              # native blocker
```

**Jira items** (source=jira — only with a repo project or `PROJ-123` in
the prompt). Fetch the named key, or ready-for-agent issues in the repo
project, with the Jira API/CLI/MCP bound to that project. Do not treat a
global Jira MCP as the reason source is jira.

- `ready-for-agent` + (parent or task type) → work item.
- `ready-for-human` and the id was **not** named → skip (not in `items`,
  or marked skip for `advance`).
- Spec/epic (container, no task type, or the parent of the work items) →
  not a PR. A prompt that is **only** that spec id → the spec-only ask,
  not a silent ship.
- **Body blockers:** under `## Blocked by` / `## Blocked-by` (until the
  next `##` heading), collect `#N` that are still open. `none` / empty /
  all closed → no body blocker.
- **Native blockers:** GitHub: open issues in `blockedBy`. Closed →
  ignore. If the schema rejects `blockedBy`, parse the body heading
  and continue. Do not abort. Beads: `bd dep` is the native blocker
  (same stacking-parent rules). Jira: body `## Blocked by` is enough
  in v1; native issue links are not in v1.
- **Stacking parent.** An open blocking *work item* that is in `items`.
  Ignore a spec/epic — that is the container, not a stacking parent. No
  such parent → root (base = trunk). One → child of that item. Several
  → parent is the largest id among those blockers (do not invent extra
  PRs). An open blocker that is not in `items` does not make a root and
  does not invent a line; do not start that child this run.
- "these open tickets" / "these tickets": ready-for-agent work items,
  optionally scoped to a parent spec named in the prompt. Still skip
  unnamed `ready-for-human`. The spec issue is not a PR.

Write `.pr-autopilot/cascade/plan.md` (typed artifact, this invocation).

Graph:

```markdown
---
cascade: true
mode: graph
trunk: <branch>
source: github | gitlab | beads | jira
---

# Forest plan

## Items
- #<id> ready-for-agent unblocked parent=#<spec|none> → ship (base=trunk)
- #<id> ready-for-agent blocked-by=#<blocker> parent=#<spec|none> → ship (base=<blocker-head>, after #<blocker> PR)
  # id shape follows source: #17 | PROJ-12 | bd-<id>
```

Existing-chain:

```markdown
---
cascade: true
mode: existing-chain
trunk: <branch>
---

# Chain plan

## Path
- #<parent-pr> head=<parent-head> base=<trunk>
- #<current-pr> head=<current-head> base=<parent-head>  (current)

## Off the path
- #<sibling-pr> stacked on #<parent-pr> (sibling, left alone)
  # omit this section when there are none
```

Also write `.pr-autopilot/cascade/state.json`:
`{cascade: true, mode, trunk, source, items, path, last_result}`.
`cascade` is from this invocation only. Graph: each item records `id`,
stacking parent (or none), intended host base, `pr` when opened or
reused, and `status` (`opened` | `failed` | `pending` | `skipped` |
`merged`).
`last_result` is `ship` | `reuse` | `skip` | `halt` | `done`. A later
`--cascade` with the same IDs resumes via reuse of those `pr` numbers.
Existing-chain: `path` is the PR numbers trunk-side first, current last;
`source` and `items` are unset. On an ask/halt, do not guess `items` or
`path`. `source` may be unset until the question is answered.

### 12.2 `advance(plan, last_result)`

`advance` is the seam. Done means the examples in §12.5 hold.

Evaluate `last_result is halt` and `requested stages unfinished`
**before** picking the next item. After halt, remaining items are
pending — do not reuse, skip, or ship them.

```
on(advance)
  if mode == existing-chain
    print the cascade tree (§12.4) for the path
    siblings and descendants stay off the tree
    do not cut a new branch
    do not ship a new work-item PR
    --title / --body apply to the current PR only
    --review / --resolve / --show-me / --unslop /
      --show-me-comments compose onto the current PR only
      (existing pipeline, reuse §3.2). Not ancestors. Not siblings.
    if those stages halted → halt; do not land
    land(plan)     # retarget a dangling child even without --merge;
                   # host merge only with --merge / --auto; --draft forbids merge
    → done
  last_result is halt → halt the forest
                        # do not reuse, do not start the next
  requested stages of current unfinished → do not start the next
  no ready item left → land(plan) then done
                        # land retargets a dangling child even without
                        # --merge; host merge only with --merge / --auto
  next ready item has open PR → reuse (restack base if needed)
  next ready item is ready-for-human and not named → skip
  next is a child and parent PR does not exist → do not start the child
  else → ship: existing pipeline, host base = parent head or trunk
               (skip Phase 6; land after the path is opened)
```

**Ready.** Roots first, tie-break by id number. A child is ready only
after its stacking-parent PR exists. After `skip`, call `advance`
again. After a finished `ship` or `reuse` (requested stages completed
without halt), set `last_result` and call `advance` again. After halt,
stop. Remaining children whose parent is not in `items` (so no parent
PR will exist this run) do not block `done` — do not start them, do not
invent a line.

**Requested stages** (for starting the next item) are the flags on
this invocation **except merge**: no extra flags → Phase 1; `--review`
→ through Phase 2; `--resolve` → through Phase 3 (and 5 as today).
`--merge` / `--auto` still run those stages per item; Phase 6 is
`land`, after the path is opened, so a child can stack on the parent
head before the parent lands. A merge refusal still halts. The next
item starts only when those (non-merge) stages **finished without
halt**. A child needs the parent PR **open**, not merged.

**`skip`:** print the work item as skipped on the cascade tree. Do not
open a PR. Do not implement it.

**`reuse`:** the work item already has an open PR. Do not open a
second. Do not reimplement it (out of scope). Do not cut a new branch.

1. **Find the open PR.** First `.pr-autopilot/cascade/state.json`
   `items[].pr` from this or a previous run with the same IDs, if that
   PR is still open. Else the host:

```bash
# GitHub — open PRs that close this work item
gh api graphql -f query='
  query($owner:String!, $repo:String!) {
    repository(owner:$owner, name:$repo) {
      pullRequests(first:50, states:OPEN) {
        nodes {
          number url baseRefName headRefName body
          closingIssuesReferences(first:20) { nodes { number } }
        }
      }
    }
  }'
# match closingIssuesReferences.nodes[].number == id
# or body Closes/Fixes/Resolves #<id> (case-insensitive)

# GitLab
glab mr list --state opened --output json
# body Closes #<id>, or a related issue

# Jira: title or body contains the issue key
# beads: title or body contains the bead id
```

   Several matches: the `pr` already in cascade state, else the oldest
   (lowest number). Closed PRs do not count.

2. **Restack** if the host base is wrong for the forest. Intended base
   = parent head (child) or trunk (root).

```bash
gh pr view <PR> --json baseRefName,headRefName
# GitLab: glab mr view <iid> --output json  (.target_branch / .source_branch)

# if baseRefName == intended: reuse as-is
# else:
git fetch origin
# existing worktree of headRefName if any; else one worktree
git checkout <headRefName>
git merge origin/<intended>     # no history rewrite; never force-push the chain
git push origin <headRefName>
gh pr edit <PR> --base <intended>
# GitLab: glab mr update <iid> --target-branch <intended>
```

   Child body keeps or sets `Stacked on: #<parent> (merge after)`
   (verbatim). Root: do not add that line. A restack merge that cannot
   resolve safely is a halt (§5.3).

3. Enter **§3.2** on that PR. `--show-me` still apply.
   `--show-me-comments` still brief. Then run the requested stages
   except Phase 6. Record `items[].pr` and
   `status=opened`. Print the tree (§12.4). `last_result=reuse` if
   those stages finished without halt; else halt. After a finished
   reuse, `land` ready PRs. If `land` halted, stop.

**Halt** (`last_result=halt`) when:

- `verification: fail`
- `--review` without `--resolve` and `blocker_count > 0`
- `conflict: escalated` or `ci: escalated`
- merge refusal (standing human `CHANGES_REQUESTED`, or a merge gate
  that failed)
- an ask `--auto` / no TTY cannot make (already in `plan`)

On halt: current item → `failed`. Every not-yet-started item →
`pending`, including independent later roots. Print the tree. Stop.
Do not call `advance` for the next item. v1 is serial: no best-effort
across siblings.

**`ship`:**

1. Load `cascade-flow` (§12.3). Missing: alert + condensed fallback;
   continue. Load once per cascade run.
2. Cut a **new** branch in a new worktree. One worktree at a time.
   Typical path: `../<repo>-wt/<branch>`. Branch name follows the
   repo's convention if documented, else `feat/<id>/<slug>`.
   **The current feature branch is not the parent and not the base.**
   Do not `git merge` it in. Do not open the PR from it.
   Being on `main`/`master` here is not an abort — graph mode does not
   use the current branch as the PR head.
   - **Root** (no stacking parent): fetch trunk. Cut from
     `origin/<trunk>`. `BASE` = trunk.
   - **Child:** the parent PR must already exist. Do not start the child
     until it does. Fetch that head
     (`gh pr view <parent-pr> --json headRefName`). Cut from
     `origin/<parent-head>`. `BASE` = parent head (the parent PR's head
     branch, not the trunk). `git merge` the parent in (no history
     rewrite).
3. In that worktree, implement the work item (issue body + acceptance).
   Every line of code through `ponytail` (§0.2). Commit. Then run
   the requested stages **except Phase 6** (`land` merges after the
   path is opened) with:
   - `BASE` = trunk (root) or parent head (child)
   - `BRANCH` = the new branch
   - `--title` / `--body` **not** stamped (ignore them in graph mode)
   - Title from the work item (commit convention)
   - Body from the work item (Summary / Changes / Test plan), humanized
     (§0.1). Close the work item, not the parent spec: GitHub/GitLab
     `Closes #<id>`; Jira the issue key in title/body; beads the bead
     id. `Closes #<spec>` / parent epic stays off.
   - Child body also includes `Stacked on: #<parent> (merge after)`
     (`<parent>` is the stacking work-item id). Keep that line
     verbatim — do not humanize or unslop it.
   - Flags already on this run compose onto that PR: `--review`,
     `--resolve`, `--merge`, `--auto`, `--show-me`, `--show-me-comments`,
     `--unslop`, `--draft`, `--merge-strategy`. `--cascade` does not
     turn merge on. `--draft` still forces no merge. Phase 6 waits for
     `land`. `--show-me-comments` without `--resolve` briefs that PR's
     comments and continues to the next work item; it does not STOP
     the forest.
4. Print the cascade tree (§12.4). Record `items[].pr` and
   `status=opened`. If the requested (non-merge) stages finished
   without halt, `last_result=ship`, `land` ready PRs, and call
   `advance` again. If ship or `land` halted, `last_result=halt`
   — do not start the next item.

Phase 1 on the work-item branch is the existing create path. `--show-me`
apply, `--show-me-comments` brief, `--draft`, review, resolve, CI —
unchanged. Host base is the trunk for a root and the parent head for a
child. Merge is `land`.

**Existing-chain `advance`.** The PRs on the path already exist. Load
`cascade-flow` once (§12.3). Print the path tree. Do not implement
work items. Graph-mode restack of a wrong work-item base is reuse
above. With `--merge` or `--auto`, `land` the path bottom-up
(ancestors then current). Siblings stay. A dangling child is
retargeted at the trunk even when `--merge` is off; `git merge`
the trunk into the feature (no force-push); re-verify. The host
merge of that PR still only happens with `--merge` / `--auto`.
`--draft` still forbids merge. Out-of-order merge of the current
PR into its still-open parent is what `--cascade` exists to stop.

**`land(plan)`** — the merge path. Done means the examples in §12.5
hold. `--cascade` does not turn this on.

```
on(land)
  # Dangling child in the path: retarget + git merge trunk in +
  # re-verify even when --merge is off. Host merge stays gated.
  for each dangling child in the path   # base != trunk, parent PR gone
    retarget_to_trunk(pr)

  if --draft → do not merge any PR; return
  if not (--merge or --auto) → do not merge any PR; return

  loop
    pr = next_land_ready(plan)
    if none → break
    land_one(pr)
    if last_result is halt → return   # do not land later items

on(next_land_ready)
  # graph: roots first (id number), then children
  # existing-chain: plan.path trunk-side first, current last
  skip merged / skipped / failed / not-yet-opened
  if standing human CHANGES_REQUESTED on pr and not re-reviewed
    → halt: do not merge pr; later items pending (§5.7)
  graph, a root (no stacking parent):
    ready once its children-in-items have a PR (or were skipped)
    # so the child exists stacked before the parent lands
  graph, a child:
    ready only after the stacking parent has merged
  existing-chain:
    the first not-yet-merged PR on the path
    # parent already merged, or this node is dangling
  siblings and descendants stay off the order

on(land_one)
  if standing human CHANGES_REQUESTED and not re-reviewed
    halt; status=failed; do not merge this PR
    return
  if pr.base != trunk
    retarget_to_trunk(pr)     # dangling, or parent just landed
  Phase 5 (CI) then Phase 6 (existing merge into the trunk)
  never force-push the trunk
  never git push -f / --force on origin/<trunk>
  if merge refused → halt
  status=merged
  print the cascade tree (§12.4)

on(retarget_to_trunk)
  # parent merged; host base still the old head (GitHub/GitLab
  # may already have retargeted — if base == trunk, skip)
  git fetch origin
  # existing worktree of pr.head if any; else one worktree
  # never check out the trunk to rewrite it
  git checkout <pr.head>
  git merge origin/<trunk>    # trunk into the feature; no rebase
                              # no force-push; never on the trunk
  # conflict → §5.3; cannot resolve safely → halt
  verification gate (§5.6)
  if fail → halt
  git push origin <pr.head>   # normal push; never -f on trunk
  gh pr edit <pr> --base <trunk>
  # GitLab: glab mr update <iid> --target-branch <trunk>
  re-run Phase 5 (CI)
  # then land_one continues to Phase 6 if --merge / --auto
  # still requested and --draft is off
```

`--force-with-lease` remains allowed only on the **feature** branch
when the user asked `--merge-strategy=rebase` (§5.3). Dangling
retarget is always `git merge` of the trunk into the feature, even
then, and even when `--merge` is off. Never on the trunk. A child
whose base is already the trunk (host auto-retargeted) skips
`retarget_to_trunk` and goes to CI; host merge only with `--merge`
/ `--auto`.

### 12.3 `cascade-flow`

Required sub-skill for stacking discipline. Load it (`Skill` tool,
`skill: "cascade-flow"`) once per cascade run. cascade-flow `--full`
is a panorama: do not print it; do not treat it as `--cascade`.

**Missing skill.** Alert and continue. Do not abort. Do not fake the
full skill. The PR still opens.

```
[cascade] cascade-flow skill missing — stacking rules below. Install with:
npx skills add FelipeOFF/skills --skill=cascade-flow
```

**Condensed fallback** (the part this pipeline depends on):

- Stack on the parent head, not the trunk, when a child has a blocker
- One unit per PR
- Merge bottom-up (root into the trunk first)
- `git merge` the parent in (no history rewrite)
- Never force-push the chain (never the trunk; no blind `-f`)

Child stacking is graph mode: host base = parent head, serial, child
body `Stacked on: #<parent> (merge after)`. Existing-chain is the path
to the current PR. With `--merge` or `--auto`, `land` merges that path
bottom-up (§12.2). `--cascade` does not turn merge on.

### 12.4 Cascade tree

When `--cascade` is on, print one short tree. Not cascade-flow `--full`.
Graph: roots hang off the trunk; a child hangs off its parent with `└→`.
Existing-chain: the path hangs off the trunk, current last; siblings
are not printed.

`source` is the picked tracker (`github` / `gitlab` / `beads` / `jira`).
Existing-chain has no tracker source — omit it.

```
cascade graph  trunk=main  source=github
main
└→ #9 [opened] PR #40  Closes #9
└→ #10 [opened] PR #41  Closes #10
└→ #11 [opened] PR #42  Closes #11
   └→ #12 [opened] PR #43  Closes #12  Stacked on: #11
```

A skipped ready-for-human (not named):

```
cascade graph  trunk=main  source=github
main
└→ #17 [opened] PR #42  Closes #17
#18 ready-for-human skipped (not named)
```

A reused PR, restacked onto the trunk:

```
cascade graph  trunk=main  source=github
main
└→ #9 [opened] PR #40 reused  restacked → main  Closes #9
```

After halt — opened / failed / pending. Independent later roots stay
pending:

```
cascade graph  trunk=main  source=github
main
└→ #9 [failed] PR #40  Closes #9
└→ #10 [pending]
└→ #11 [pending]
   └→ #12 [pending]
```

Existing-chain (current PR `#12` stacked on `#11`, sibling `#13` also
on `#11`):

```
cascade existing-chain  trunk=main
main
└→ #11 [opened]
   └→ #12 [opened]  (current)
```

`#13` is not on that tree.

After `--cascade --merge` lands `#11` then retargets `#12`:

```
cascade graph  trunk=main  source=github
main
└→ #11 [merged] PR #42  Closes #11
   └→ #12 [merged] PR #43  Closes #12  retargeted → main
```

Statuses: `opened` (created or reused), `skipped`, `failed`,
`pending`, `merged`.

### 12.5 Examples (completion criterion for plan / advance / land)

1. `pr-autopilot --auto` with no cascade phrase, current branch against
   `main` → plan: not this feature. One PR to `main`. No forest.
   `advance` is not called.
2. Origin GitHub, `--cascade` (or "cascade these tickets"), one unblocked
   `ready-for-agent` work item `#17` with parent spec `#16`, current
   branch `feat/leftover` → plan: `mode=graph`, `source=github`,
   `items=[#17]`, trunk = `--base` or repo default. `advance`: ship.
   New branch cut from trunk; `feat/leftover` is not the parent.
   Requested stages with host base = trunk. PR body has `Closes #17`
   and does not close `#16`. Short tree printed. No merge.
3. Same as 2 with `--title` / `--body` set → those flags are not stamped
   on the work-item PR. Title and body still come from `#17`.
4. Same as 2 with `--review` / `--show-me` / `--show-me-comments` /
   `--unslop` / `--draft` passed → those flags compose onto that PR.
   `--cascade` does not turn `--merge` on. `--show-me-comments`
   without `--resolve` briefs that PR and continues; it does not
   STOP the forest.
5. `#17` ready-for-agent unblocked, `#18` ready-for-human and not named
   → `#18` skipped; `#17` shipped.
6. `--cascade` on, `cascade-flow` missing → alert +
   `npx skills add FelipeOFF/skills --skill=cascade-flow`; condensed
   fallback in §12.3; the PR still opens.
7. Origin GitHub, `--cascade` with `#9 #10 #11` unblocked and `#12`
   blocked by `#11`, current branch `feat/leftover` → plan: `mode=graph`,
   `items=[#9,#10,#11,#12]`. Three roots against the trunk (`#9` `#10`
   `#11`); `#12` stacked on `#11`'s head. `feat/leftover` is not a
   parent. Serial: `#11`'s PR exists before `#12` is cut. Short tree
   shows roots and `└→` children.
8. `--cascade` "these open tickets" on a spec whose children are
   `#9`–`#13` → work items only; the spec issue is not a PR.
9. Prompt has `#9` and the current PR is stacked → graph mode (IDs
   win). Do not walk the existing chain.
10. Child PR body contains `Stacked on: #<parent> (merge after)` and
    `Closes #<child>`. It does not close the spec.
11. `pr-autopilot --cascade` with only the spec id, interactive → ask
    children vs one PR. `--auto --cascade` with only the spec id →
    halt, no guess.
12. Origin GitHub, Jira MCP installed globally, `--cascade` "these
    tickets", no `PROJ-*` ids → GitHub source, no Jira question.
13. Origin GitLab, `--cascade` → GitLab issues are the source. No GitHub
    question.
14. `.beads/` present → beads are a detected source. A Cairn ticket is
    beads, not a fourth tracker.
15. Prompt `PROJ-12` → Jira source, no question.
16. Prompt `#9` (origin GitHub) → GitHub source, no question.
17. Prompt is a `bd` id → beads source, no question.
18. Two sources in this repo and no disambiguating ids, interactive →
    one question which graph. Same case with `--auto --cascade` → halt,
    no guess.
19. Zero sources and the current PR already on the trunk, interactive →
    one question which work items. Same case with `--auto --cascade` →
    halt, no guess.
20. No tracker config file. A globally installed MCP is never why a
    source was picked.
21. Work item `#9` already has an open PR against the wrong base →
    `advance`: reuse that PR, restack onto the parent head or trunk.
    No second PR.
22. `#9` verification fails (or `--review` without `--resolve` and a
    BLOCKER) → `last_result=halt`. `#10` (independent root) is not
    started. Tree lists `#9` failed and later items pending. Do not
    reuse, skip, or ship them.
23. `--cascade --review` on `#9` then `#10`; `#9` Phase 2 still
    running → do not start `#10` until `#9`'s requested stages
    finished without halt.
24. Current PR `#12` stacked on `#11` (base is `#11`'s head, not the
    trunk), sibling `#13` also stacked on `#11`, `--cascade` with no
    IDs → plan: `mode=existing-chain`, path = trunk → `#11` → `#12`.
    `#13` is not on the path. Short tree prints that path with
    `(current)` on `#12`. No merge. No new work-item PR.
25. Same as 24 with `--cascade --merge` or `--cascade --auto` → `land`
    merges `#11` then `#12`. `#13` stays open.
26. Same as 24 with `--title` / `--body` set → those flags apply to
    `#12` only. Not to `#11`. Not to `#13`.
27. Same as 24 with `--review` / `--show-me` / `--show-me-comments` /
    `--unslop` → those flags compose onto `#12` only. Not ancestors.
    Not siblings. `--merge` on the same run still `land`s the path
    (ancestors plus current).
28. Origin GitLab, current MR stacked on another MR, `--cascade` with
    no IDs → existing-chain on GitLab MRs. Same path rule. Same
    sibling rule. `--cascade --merge` lands that MR path the same way.
29. `--cascade --merge` with `#11` unblocked and `#12` blocked by
    `#11` → ship `#11` (base = trunk) then `#12` (base = `#11`'s
    head). `land` merges `#11` into the trunk first; if `#12` still
    pointed at the old head, retarget trunk, `git merge` trunk into
    the feature (no force-push), re-verify, then merge `#12`.
30. `--cascade` without `--merge` and without `--auto` → forest or
    chain opens (or is walked). None merge.
31. Dangling child: parent already merged, current PR still targets
    the old head → retarget trunk, `git merge` trunk into the
    feature, re-verify, even when `--merge` is off. With
    `--cascade --merge`, then merge. Without `--merge` / `--auto`,
    the host merge does not run.
32. `--cascade --draft --merge` → PRs may open as draft; `land` does
    not merge; none merge. A dangling child on that path is still
    retargeted.
33. Standing human `CHANGES_REQUESTED` on a PR in the path → that PR
    is not merged, no matter how green CI is. Halt. Later items
    pending.
34. `land` never force-pushes the trunk. Dangling retarget is
    `git merge origin/<trunk>` into the feature, then a normal push.
