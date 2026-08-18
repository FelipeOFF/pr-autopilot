---
name: pr-autopilot
description: Orchestrates the full lifecycle of a Pull Request — creation, multi-agent code review, triage of every comment already on the PR (human and bot), automated fixes with inline replies, merge-conflict resolution, CI failure attribution and repair, and auto-merge. Use when the user wants to ship a branch end-to-end with minimal supervision, or to work through the feedback and red CI a PR already has (e.g. "open PR and merge", "/pr-autopilot", "ship this branch", "resolve the PR comments", "fix the failing CI on my PR", "review and merge my branch"). Supports GitHub (gh) and GitLab (glab). Coordinates Reviewer and Author subagents via the Task tool.
argument-hint: "[--auto] [--review] [--resolve] [--merge] [--draft] [--max-iterations <N>] [--merge-strategy squash|merge|rebase] [--base <branch>] [--platform github|gitlab] [--ci-timeout <sec>] [--ci-poll-interval <sec>] [--title <text>] [--body <text>]"
---

# pr-autopilot

End-to-end PR pipeline: **create → (review → respond → re-review loop) → triage every comment on the PR → resolve conflicts & fix CI → wait for CI → merge**.

**Everything past PR creation is opt-in.** Every boolean flag defaults to `false`. With no flags the skill creates the PR and stops. You switch on each stage explicitly (`--review`, `--resolve`, `--merge`) or turn them all on at once with `--auto`.

This skill is **rigid**. Follow the phases in order. Do not skip the verification gates between phases. Coordinate subagents via the `Task` tool (or `Agent` tool depending on harness). Persist intermediate artifacts to `.pr-autopilot/<pr-number>/` so iterations and re-runs are recoverable.

### Writing style — humanize everything posted to the PR

Every piece of prose that lands on the PR — the PR body, each inline review
comment, each inline reply, and the top-level review summary — **must be passed
through the `humanizer` skill before posting**. The humanizer strips signs of
AI-generated writing (rule-of-three, em-dash overuse, inflated symbolism, vague
attributions, filler phrases, negative parallelisms) so the text reads like a
human teammate wrote it.

Rule of thumb for every phase that writes prose:

1. Draft the text (PR body / comment / reply).
2. Invoke the `humanizer` skill on that draft (`Skill` tool, `skill: "humanizer"`),
   passing the drafted text as input.
3. Post the humanized output — never the raw draft.

Do **not** humanize: code snippets, severity tags (`[BLOCKER]`, `[SUGGESTION]`,
`[NITPICK]`), status tags (`✅ FIXED`, `🛑 REFUTED`, `⏸ DEFERRED`, `🤷 SKIPPED`,
`💬 ANSWERED`), machine markers (`<!-- pr-autopilot:ci-triage:... -->`),
file paths, SHAs, or the front-matter of local artifacts. Humanize only the
natural-language explanation between those structural markers.

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
| **Review + resolve** | `--review --resolve` | Phase 1 → Phase 2 → Phase 3 → loop → STOP before merge. Add `--merge` to merge on green CI. |
| **Auto (full hands-off)** | `--auto` | Everything on: review + resolve + wait ALL CI + merge, no prompts. Resolves merge conflicts and fixes failing CI along the way. Halts or escalates only on a guardrail it must not cross. |

Rules that tie the flags together:

- `--resolve` is **independent of** `--review`. On its own it runs the Author against the feedback the PR already has — teammates' comments, Copilot/CodeRabbit/Sonar findings, merge conflicts, red CI — without posting a review of its own. That is the mode for a PR a human already reviewed.
- `--review --resolve` (and `--auto`) keeps the old behavior: pr-autopilot reviews first, then the Author resolves that review *plus* everything else already on the PR.
- `--merge` is what enables the merge. Without it (and without `--auto`), the pipeline always stops before merging, no matter how green CI is.
- `--auto` is shorthand for `--review --resolve --merge` plus a "never prompt for confirmation" semantic **and** the aggressive-resolution behavior: in `--auto` (and any `--resolve`) run, the Author resolves merge conflicts and fixes failing CI, not just review comments.
- `--draft` forces no merge even when `--merge`/`--auto` is set.
- **No prompts means no consent.** Anything that needs the developer's explicit yes — a business-rule change (`groom-me`), or a comment claiming CI is red for reasons outside the PR — is never done silently in `--auto` or in a non-interactive run. It is recorded as `escalated` instead.

`--auto` does **not** weaken any guardrail: a fix that regresses tests, a conflict
that touches business logic, an unresolved BLOCKER, or a still-red required check
all halt or escalate. The merge step only executes when Phase 5 reports every
required check green AND the PR is `MERGEABLE`.

### All flags

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | `false` | Full hands-off. Turns on `--review`, `--resolve`, `--merge`, disables prompts, and lets the Author resolve conflicts + fix CI. |
| `--review` | `false` | Run the Reviewer subagent (inline comments). |
| `--resolve` | `false` | Run the Author subagent — triages every comment already on the PR (human and bot), addresses the actionable ones, resolves merge conflicts, and fixes failing CI. Does **not** imply `--review`; combine them to also post a fresh review first. |
| `--merge` | `false` | Enable auto-merge once every required check is green and the PR is `MERGEABLE`. Without it (or `--auto`) the pipeline stops before merge. |
| `--max-iterations` | `2` | Max review→respond (and CI-fix) cycles before escalating to the user. |
| `--merge-strategy` | `squash` | One of `squash`, `merge`, `rebase`. |
| `--base` | auto-detect | Target branch. Defaults to repo default branch (`main`/`master`/`trunk`). |
| `--draft` | `false` | Open PR as draft. Forces no merge. |
| `--platform` | auto-detect | `github` or `gitlab`. Auto-detected from remote URL. |
| `--ci-timeout` | `1800` | Seconds to wait for checks before bailing. |
| `--ci-poll-interval` | `30` | Seconds between status polls. Backs off to 60s after 10 polls. |
| `--title` | auto-generated | Override generated title. |
| `--body` | auto-generated | Override generated body. |

Boolean flags accept a bare form (`--review`) or an explicit value
(`--review=true` / `--review=false`). The bare form means `true`. An explicit
`--review=false` is only useful to cancel a flag that `--auto` would otherwise
turn on (e.g. `--auto --merge=false` → do everything but stop before merge).

### Invocation flow (decision tree)

```
pr-autopilot
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
   └─ --review --resolve ► PR → inline review → Author resolves that review
                            AND everything else on the PR → STOP before merge
                            (add --merge to merge on green CI)
```

Invocation examples:
- `pr-autopilot` → create the PR and stop
- `pr-autopilot --merge` → create PR + auto-merge on green CI (no review)
- `pr-autopilot --review` → create PR, post inline review, stop
- `pr-autopilot --resolve` → Author works the feedback the PR already has (no new review), stop before merge
- `pr-autopilot --review --resolve` → post a review, then resolve it plus everything else
- `pr-autopilot --resolve --merge` → resolve existing feedback + merge on green CI
- `pr-autopilot --auto` → full hands-off; merges only when CI is green
- `pr-autopilot --auto --merge-strategy=rebase --max-iterations=3`

If no flags are present and the invocation is interactive, the orchestrator MAY
prompt once: "Which mode? [1] PR only (default)  [2] PR + merge  [3] PR + review
[4] Resolve what's already on the PR  [5] Review + resolve  [6] Auto (full
hands-off)". In non-interactive mode with no flags, default to mode 1 (PR only) —
create the PR and stop.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      pr-autopilot (orchestrator)                │
│                                                                 │
│  Phase 1: Preflight + PR Creation                               │
│      │                                                          │
│      ▼                                                          │
│  Phase 2: Reviewer subagent (Task)  ──► review-report.md        │
│      │     (skipped when --resolve runs without --review)       │
│      ▼                                                          │
│  Phase 3: Author subagent (Task)    ──► pr-feedback.md          │
│      │     triages EVERY comment on the PR — human and bot ──►  │
│      │     fixes them, resolves merge conflicts,   response-    │
│      │     attributes and fixes failing CI,        summary.md   │
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

Phase 3 only runs under `--resolve`/`--auto`. When it runs, the Author's job is
the whole PR: it triages every comment already on it (teammates, Copilot,
CodeRabbit, Sonar — inline and top-level), resolves merge conflicts, and fixes red
CI. It escalates to the user (via the `groom-me` skill) whenever a change would
touch a business rule, and asks before claiming on the PR that a red check is
someone else's problem. Phase 2 is skipped entirely when `--resolve` runs without
`--review`. Phase 6 only runs under `--merge`/`--auto`.

---

## 3. Phase 1 — Preflight + PR Creation

### 3.1 Preflight (fail fast)

Run these checks before anything else. Abort with a clear message on failure.

```bash
# Inside a git repo?
git rev-parse --is-inside-work-tree

# Current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
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

### 3.2 PR existence check

If a PR already exists for this branch, **reuse it** (skip creation, jump to Phase 2 with that PR number). Do not error out — that's a normal re-run.

```bash
# GitHub
gh pr view --json number,url,state -q '.number' 2>/dev/null

# GitLab
glab mr list --source-branch "$BRANCH" --output json | jq '.[0].iid'
```

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

6. **Humanize the body before creating the PR.** Pass the generated Summary +
   Changes prose through the `humanizer` skill (`Skill` tool, `skill: "humanizer"`)
   and use its output as the PR body. Leave the `## Test plan` checklist, file
   paths, and backticked identifiers intact — humanize only the sentence prose.

### 3.4 Create PR

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
- Initialize `.pr-autopilot/<PR_NUMBER>/state.json` with `{iteration: 0, status: "created"}`

### 3.5 Post-creation routing

Route by the flags that are on (`--auto` implies `--review`, `--resolve` and
`--merge`):

- **No `--review`, `--resolve`, `--merge` or `--auto`** → STOP here. Print the PR
  URL and exit. This is the default "PR only" mode.
- **`--review`** (with or without `--resolve`) → go to **Phase 2**.
- **`--resolve` without `--review`** → skip Phase 2 entirely and go straight to
  **Phase 3** with `Trigger=pr-feedback`. There is no `review-report.md` this run;
  the Author's findings come from the PR's own comments (§5.1).
- **`--merge` only** (no review, no resolve) → go to **Phase 5** (CI), then
  **Phase 6** (merge).

---

## 4. Phase 2 — Reviewer Subagent (inline comments)

Spawn one subagent per iteration. Use the `Task` tool with `subagent_type: "general-purpose"` (or `code-reviewer` if available in the harness).

**Hard requirement:** every finding must be posted as an **inline comment on the exact line of code** it refers to. A standalone PR comment (not anchored to a line) is **not** an acceptable output, except for the top-level review summary.

### 4.1 How to post inline comments

#### GitHub — single review with inline comments

The Reviewer must build all comments and submit them in **one** review using `gh api`:

```bash
# 1. Determine commit SHA the comments anchor to (the latest commit on HEAD)
COMMIT_SHA=$(git rev-parse HEAD)

# 2. POST the review with inline comments in a single call.
#    Each comment carries: path, line, side ("RIGHT" for added/modified lines,
#    "LEFT" for removed-only context), body, and severity tag in the body.
gh api -X POST "repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews" \
  -f commit_id="$COMMIT_SHA" \
  -f event="REQUEST_CHANGES" \   # or "COMMENT" if blocker_count == 0
  -f body="<top-level summary>" \
  -F "comments[][path]=src/foo.ts"      -F "comments[][line]=42"  -F "comments[][side]=RIGHT" \
  -F "comments[][body]=[BLOCKER] <title>\n\n**Problem:** ...\n**Why it blocks:** ...\n**Suggested fix:**\n\`\`\`ts\n...\n\`\`\`" \
  -F "comments[][path]=src/bar.ts"      -F "comments[][line]=88"  -F "comments[][side]=RIGHT" \
  -F "comments[][body]=[SUGGESTION] ..." \
  ...
```

For a multi-line comment, use `start_line` + `start_side` + `line` + `side` instead of just `line`.

The body of every inline comment **must** start with one of:
`[BLOCKER]`, `[SUGGESTION]`, `[NITPICK]`. This tag is what the Author parses next.

If `gh api` rejects a `line` (e.g. the line is unchanged in the diff), the Reviewer must anchor to the **nearest changed line** in the same hunk and prefix the body with `(near line X)` so the location is clear. Never silently drop a finding.

#### GitLab — discussions on diff position

```bash
# Need: project_id, MR iid, base_sha, head_sha, start_sha
# Get them from: glab api projects/:id/merge_requests/<iid>?include_diverged_commits_count=true

glab api -X POST "projects/:id/merge_requests/<MR_IID>/discussions" \
  -F body="[BLOCKER] ..." \
  -F position[position_type]=text \
  -F position[base_sha]=$BASE_SHA \
  -F position[head_sha]=$HEAD_SHA \
  -F position[start_sha]=$START_SHA \
  -F position[new_path]=src/foo.ts \
  -F position[new_line]=42
```

Repeat per finding. GitLab does not bundle them into a single review object.

### 4.2 Reviewer prompt template

```
You are the Reviewer agent in the pr-autopilot pipeline. You are stateless and have
no prior context — everything you need is below.

PR: <PR_URL>
Platform: <github|gitlab>
PR number / MR iid: <PR_NUMBER>
Owner/repo (or project_id): <SLUG>
Base: <BASE>
Head: <BRANCH>
Head SHA: <HEAD_SHA>
Iteration: <N> of <MAX>
Repo root: <CWD>

YOUR TASK
1. Read the full diff: git diff <BASE>...<BRANCH>
2. Read the changed files in their current state.
3. Evaluate against:
   - Correctness and edge cases
   - Security (injection, secret leakage, authz bypass, OWASP-class)
   - Performance (N+1, unbounded loops, blocking I/O on hot paths)
   - Code quality (naming, dead code, premature abstraction, missing
     error paths at trust boundaries)
   - Consistency with surrounding codebase patterns
   - Test coverage proportional to risk

CLASSIFICATION
Each finding is exactly one of:
  BLOCKER    — must be fixed before merge
  SUGGESTION — should likely be fixed
  NITPICK    — optional/aesthetic

POSTING THE REVIEW (mandatory inline format)
You MUST post each finding as an INLINE comment anchored to the exact file +
line number. Do NOT post a single bulk comment with all findings.

GitHub:
  Build the full list of inline comments and submit them in ONE review via
  `gh api -X POST repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews` with the
  `comments[]` array. Use event=REQUEST_CHANGES if any BLOCKER, otherwise
  event=COMMENT.

GitLab:
  POST one discussion per finding via
  `glab api projects/:id/merge_requests/<iid>/discussions` with a `position`
  block (base_sha, head_sha, start_sha, new_path, new_line).

Each inline comment body MUST start with the severity tag, e.g.:

  [BLOCKER] Missing authz check on /admin/users
  
  **Problem:** the handler trusts the X-User header without verification.
  **Why it blocks:** privilege escalation.
  **Suggested fix:**
  ```ts
  if (!req.session?.isAdmin) return res.status(403).end();
  ```

If the diff makes a line uncommentable (unchanged context outside the hunk),
anchor to the nearest CHANGED line in the same hunk and prefix the body with
`(near line N)`. Never silently drop a finding.

HUMANIZE BEFORE POSTING (mandatory)
Before you POST anything to the PR, run every natural-language body through the
`humanizer` skill (Skill tool, skill: "humanizer"):
  - the top-level review summary, and
  - the explanation prose inside each inline comment ("Problem", "Why it blocks",
    and any narrative text).
Humanize only the prose. Keep the leading severity tag ([BLOCKER]/[SUGGESTION]/
[NITPICK]), code snippets, file paths, and line refs exactly as drafted. Post the
humanized text — never the raw draft. This makes the review read like a human
reviewer wrote it.

OUTPUT (also write a local artifact)
Write .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md with this exact
front-matter and a list of every finding INCLUDING the comment_id returned
by the API for each one (you'll need them in the response phase):

---
verdict: APPROVED | CHANGES_REQUESTED
blocker_count: <int>
suggestion_count: <int>
nitpick_count: <int>
review_id: <id returned by GitHub review POST, or "n/a" for GitLab>
---

# Review — iteration <N>

## Summary
<2–4 sentences — same content as the top-level review body posted to the PR>

## Inline findings

### [BLOCKER] <title>
- File: `path/to/file.ts:42`
- comment_id: <id from API response>
- url: <html_url from response>
- Problem: ...
- Suggested fix: ...

(repeat per finding, in posting order)

## Verdict
APPROVED  (only if blocker_count == 0)
or CHANGES_REQUESTED

Be specific. Do not write speculative findings.
```

### 4.3 Orchestrator post-processing

After the Reviewer returns, parse the front-matter of `review-report.md`:

- `verdict: APPROVED` and `blocker_count: 0`:
  - `--resolve`/`--merge`/`--auto` on → jump to **Phase 5** (CI). Under `--resolve`/`--auto`, a red check loops back to the Author to fix it; once every check is green, Phase 6 merges only if `--merge`/`--auto`, otherwise STOP.
  - review only (none of `--resolve`/`--merge`/`--auto`) → STOP. Print the PR URL and exit (review passed, nothing else requested).
- `verdict: CHANGES_REQUESTED` and `--resolve` off → STOP (mode "PR + review"). Print the PR URL and exit.
- `verdict: CHANGES_REQUESTED` and `--resolve` on → proceed to **Phase 3**.
- Malformed front-matter, or any finding without a `comment_id` → re-spawn Reviewer once with explicit format reminder; on second failure, escalate to user.

---

## 5. Phase 3 — Author Subagent (Resolve everything: PR feedback, conflicts, CI)

This phase only runs when `--resolve` (or `--auto`) is set. Otherwise the pipeline stops at the end of Phase 2.

The Author owns the **whole PR**, not just the findings pr-autopilot itself produced.
Its job is to make the PR clean and mergeable. It has four responsibilities, in this
order:

1. **Inventory & triage every comment already on the PR** — human or bot, inline or top-level (§5.1).
2. **Address each actionable finding** — fix, refute, defer or answer, with an inline reply on the comment (§5.2).
3. **Merge conflicts** — if the PR conflicts with the base branch, resolve them (§5.3).
4. **Failing CI** — decide whether the failure is even this PR's fault, then fix it or say so (§5.4).

All four respect the **business-logic escalation protocol** (§5.5): the Author never
silently changes a business rule. When a comment, a conflict or a CI fix would alter
what the software decides, allows, blocks, or charges, it stops and consults the user
through the `groom-me` skill first.

**Hard requirement:** every actionable comment gets an inline **reply** on that same
comment, stating whether it was FIXED, REFUTED, DEFERRED, SKIPPED or ANSWERED. A
standalone "I addressed everything" PR comment is **not** acceptable.

### 5.1 Inventory & triage every comment on the PR

The Author never works from `review-report.md` alone. A review left by a teammate, by
GitHub Copilot, by CodeRabbit, by SonarCloud or by any other bot is a real finding and
gets the same treatment. When `Trigger=pr-feedback` (a `--resolve` run without
`--review`), this inventory is the *only* source of findings — there is no
`review-report.md` at all.

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
| `QUESTION` | Wants an answer, not a code change ("does this handle the empty case?") | Reply `💬 ANSWERED`, no commit |
| `NOISE` | "LGTM", praise, emoji, CI status chatter, duplicated bot output | Count it, reply to nothing |
| `ALREADY_HANDLED` | Thread is `isResolved`/`resolved`, or a later reply already carries a pr-autopilot status tag | Skip — never re-answer |

**The Author's own past replies are state, not input.** A comment written by the
account pr-autopilot runs under, whose body starts with one of the status tags
(`✅ FIXED` / `🛑 REFUTED` / `⏸ DEFERRED` / `🤷 SKIPPED` / `💬 ANSWERED`), marks its
parent thread `ALREADY_HANDLED`. Reading those replies is how the Author knows what
iteration N-1 already did; treating them as new findings is how it would spend
forever answering itself.

**Deduplicate against `review-report.md`.** Under `--review --resolve`, the comments
the Reviewer just posted show up in both sources. Match them by `comment_id` and keep
the `review-report.md` entry — it already carries the severity and the reasoning.
Never open two work items, and never post two replies, for one comment.

**Step 3 — assign a severity.** External comments arrive without pr-autopilot's
severity tags, so infer one:

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

### 5.2 Address findings & reply inline

Work the inventory in severity order (BLOCKER → SUGGESTION → NITPICK), plus every
finding in `review-report.md` when `Trigger=review`.

| Severity | Obligation |
|----------|------------|
| `BLOCKER` | Must be addressed: apply a fix, or REFUTE it with concrete code evidence. Refusing a BLOCKER without refutation is not allowed. |
| `SUGGESTION` | Apply if low-risk and within PR scope, else DEFER with a reason. |
| `NITPICK` | Apply if trivial, else SKIP. |
| `QUESTION` | Answer it. No commit needed. |

A finding marked `business_rule: yes` goes through `groom-me` (§5.5) **before** any
code is written for it.

#### GitHub — reply to a specific review comment

```bash
# Reply on an existing pull-request review comment:
gh api -X POST "repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<comment_id>/replies" \
  -f body="✅ FIXED in <commit_sha> — switched to session.isAdmin guard."
```

A top-level comment has no reply endpoint — answer it with a new issue comment that
quotes the line it responds to:

```bash
gh api -X POST "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments" \
  -f body="> <quoted original>

✅ FIXED in <sha> — ..."
```

#### GitLab — reply to a discussion

```bash
glab api -X POST \
  "projects/:id/merge_requests/<MR_IID>/discussions/<discussion_id>/notes" \
  -F body="✅ FIXED in <commit_sha>"
```

The reply body MUST start with one of these status tags:

| Tag | Meaning |
|-----|---------|
| `✅ FIXED in <sha>` | Code was changed to address the finding |
| `🛑 REFUTED` | The finding is factually wrong; reply explains why with code evidence |
| `⏸ DEFERRED` | Acknowledged, not fixed in this PR; explains the follow-up plan |
| `🤷 SKIPPED` | Allowed only for NITPICKs the author chose to ignore |
| `💬 ANSWERED` | The comment was a question; the reply answers it, no code changed |

The orchestrator parses these tags to validate that no BLOCKER got `SKIPPED`, and
the next iteration parses them to know which threads are already handled (§5.1).

### 5.3 Resolve merge conflicts

If the PR conflicts with its base branch, the Author resolves the conflict on the
**feature branch** — never by rewriting the base, never with a blind `--force`.

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

3. **Only on an explicit yes, post it** as a top-level comment. Run the prose through
   the `humanizer` skill first; keep the evidence lines and the marker verbatim:

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
the reviewer's comment is the input to `groom-me`, not a substitute for it. Reply
`⏸ DEFERRED` on that comment if the user cannot be reached.

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
Trigger: <pr-feedback | review | ci-fix>   (why you were spawned this round)
Interactive: <yes|no>   (no ⇒ you may not prompt; escalate instead of asking)
Review report: .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md   (present only when Trigger=review)
Repo root: <CWD>

You own the whole PR, not just the findings pr-autopilot produced. Make it clean and
MERGEABLE. Do the parts that apply this round, in this order: (A) inventory + triage
every comment on the PR, (B) address the findings, (C) merge conflicts, (D) failing CI.

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
(A) INVENTORY + TRIAGE EVERY COMMENT ON THE PR   (always, every round)
Pull ALL of it — human and bot, inline and top-level:
     gh api repos/<SLUG>/pulls/<PR_NUMBER>/comments  --paginate
     gh api repos/<SLUG>/issues/<PR_NUMBER>/comments --paginate
     gh api repos/<SLUG>/pulls/<PR_NUMBER>/reviews   --paginate
     gh api graphql ... pullRequest.reviewThreads { isResolved isOutdated }
     GitLab: glab api projects/:id/merge_requests/<iid>/discussions --paginate

Classify each: CRITIQUE (asks for a change) | QUESTION (wants an answer) |
NOISE (LGTM/praise/bot chatter) | ALREADY_HANDLED (thread resolved, or a reply
already carries a pr-autopilot status tag).

YOUR OWN PAST REPLIES ARE STATE, NOT INPUT. A comment from your own account starting
with ✅ FIXED / 🛑 REFUTED / ⏸ DEFERRED / 🤷 SKIPPED / 💬 ANSWERED marks that thread
ALREADY_HANDLED. Read them to know what the last round did; never answer them.

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

──────────────────────────────────────────────────────────────────────────────
(B) ADDRESS THE FINDINGS
Work the inventory in severity order, plus every finding in review-report.md when
Trigger=review (it carries each finding's comment_id).

  BLOCKER    — you MUST address. Either (a) apply a code fix, or (b) if the finding
               is factually wrong, REFUTE it with concrete evidence (cite the code
               that already handles the case). Refusing a BLOCKER without
               refutation is not allowed.
  SUGGESTION — apply if low-risk and within PR scope. Otherwise mark DEFERRED with
               a clear reason.
  NITPICK    — apply only if trivial; otherwise SKIPPED is acceptable.
  QUESTION   — answer it; no commit needed.
  business_rule: yes — GOLDEN RULE (groom-me) BEFORE writing any code for it.

Per finding, in order:
1. Make the code change (file-scoped; do not introduce unrelated edits).
2. Stage and commit using Conventional Commits + Jira when applicable:
     fix(JIRA-XXX): Address review iter-<N> — <brief>
   Capture the resulting commit SHA.
3. Post an inline REPLY on the corresponding comment:
     GitHub (inline comment):
       gh api -X POST repos/<SLUG>/pulls/<PR_NUMBER>/comments/<comment_id>/replies \
         -f body="<status_tag> — <one-line explanation>\n\n<optional: snippet of new code>"
     GitHub (top-level comment — no reply endpoint; quote the original):
       gh api -X POST repos/<SLUG>/issues/<PR_NUMBER>/comments \
         -f body="> <quoted original>\n\n<status_tag> — ..."
     GitLab:
       glab api -X POST projects/:id/merge_requests/<iid>/discussions/<discussion_id>/notes \
         -F body="<status_tag> — ..."
   The reply body MUST start with exactly one of:
     ✅ FIXED in <sha>   🛑 REFUTED   ⏸ DEFERRED   🤷 SKIPPED (NITPICK only)
     💬 ANSWERED (QUESTION only)

   HUMANIZE BEFORE POSTING (mandatory): run each reply's natural-language
   explanation through the `humanizer` skill (Skill tool, skill: "humanizer").
   Keep the leading status tag, the SHA, and any code snippet exactly as drafted —
   humanize only the prose between them. Post the humanized reply, never the raw
   draft.

   Resolve the conversation if the platform supports it and the action is FIXED or
   REFUTED:
     gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<id>"}){thread{isResolved}}}'
     glab api -X PUT projects/:id/merge_requests/<iid>/discussions/<discussion_id>?resolved=true

──────────────────────────────────────────────────────────────────────────────
(C) MERGE CONFLICTS  (whenever the PR conflicts with base)
Resolve on the FEATURE branch, no history rewrite, no force-push:
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
(D) FAILING CI  (whenever a required check is red) — ATTRIBUTE FIRST
     gh pr checks <PR_NUMBER> --json name,state,link,workflow
     gh run view <run_id> --log-failed   # GitHub — failing steps
     glab ci status && glab ci trace     # GitLab

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
    c) ON YES — post it as a top-level comment, prose humanized via the `humanizer`
       skill, evidence lines and marker verbatim, ending with:
         <!-- pr-autopilot:ci-triage:<check-name> -->
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
replies that claim FIXED. Write a failure record into the response summary and stop.

OUTPUT
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
- If `conflict: escalated` or `ci: escalated` → halt and surface exactly what needs a human decision (the Author already consulted `groom-me` where it could). When `ci_triage_comment: not-asked`, print the drafted comment body so the user can post it themselves in one paste. Do **not** merge.
- Validate: every BLOCKER must have `Action: FIXED` or `REFUTED`. Any BLOCKER with `DEFERRED`/`SKIPPED` → halt and escalate (this is a guardrail violation). This applies to BLOCKERs inferred from external `CHANGES_REQUESTED` reviews exactly as it does to pr-autopilot's own.
- If a human left `CHANGES_REQUESTED` and has not re-reviewed, the PR is not mergeable regardless of CI — never merge past a standing human block.
- If everything green → increment iteration counter. Under `--review` (or `--auto`), return to **Phase 2** with iteration N+1; under a `--resolve`-only run, go to **Phase 5**.
- After `MAX_ITERATIONS` cycles still not APPROVED (or CI still red) → escalate: print summary of remaining BLOCKERs / red checks and ask user how to proceed (extend iterations / abort). Never force a merge past a guardrail.

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
  - **All required checks `success`/`neutral`** → proceed to **Phase 6** (merge) if `--merge`/`--auto`, otherwise STOP and print the green PR URL.
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
| PR already exists | Reuse PR number, skip creation |
| Working tree dirty | Ask user to commit; do not auto-stash |
| Push rejected (non-fast-forward) | Stop, ask user — do not force-push |
| Author agent breaks lint/tests | Halt loop, surface logs |
| Reviewer never approves (max iter hit) | Escalate with remaining BLOCKERs summary |
| CI fails, `--resolve`/`--auto` on | Author attributes it first (§5.4). `pr` → fix, re-poll, escalate after `--max-iterations`. `external` → never patch around it |
| CI fails for reasons outside the PR | Ask the dev (`AskUserQuestion`) before commenting that on the PR; check the `<!-- pr-autopilot:ci-triage:<check> -->` marker first so it is said once, never twice |
| CI fails externally, non-interactive/`--auto` | Do **not** comment — no prompt means no consent. Record `ci: escalated`, `ci_triage_comment: not-asked`, print the drafted body for the human to post |
| CI fails, resolve off | Surface failing job logs, stop |
| PR has comments from humans or other bots | Author triages all of them (§5.1), inline and top-level, with the same severity rules as its own findings |
| Author's own earlier replies on the PR | Read as state (what round N-1 did), never re-answered — a reply carrying a status tag marks its thread `ALREADY_HANDLED` |
| A reviewer asks for a business-rule change | The request is input to `groom-me`, not authorization. Confirm with the user first; `⏸ DEFERRED` if unreachable |
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
state.json                       # {iteration, status, pr_url, platform, started_at}
iter-1/review-report.md          # absent when --resolve runs without --review
iter-1/pr-feedback.md            # inventory of every comment already on the PR
iter-1/response-summary.md
iter-2/review-report.md
iter-2/pr-feedback.md
iter-2/response-summary.md
ci/last-poll.json
merge.json                       # post-merge metadata
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

# Post a review first, then resolve it plus everything else on the PR
pr-autopilot --review --resolve

# Resolve existing feedback + merge on green CI
pr-autopilot --resolve --merge

# Auto mode with tighter loop and rebase merge
pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
pr-autopilot --draft

# Override base branch
pr-autopilot --merge --base=develop
```

---

## 11. Output to User

Keep terminal output terse. Per phase, emit one line:

```
[mode] --auto (full hands-off)
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 inline comments posted
[3/6] Author iter 1   → triaged 12 comments (7 actionable, 3 noise, 2 already handled)
[3/6] Author iter 1   → 2 fixed, 1 deferred, 1 answered, replies posted, pushed abc1234
[3/6] Author iter 1   → conflict in `pricing.ts` resolved (merged base, groom-me confirmed) def5678
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: waiting… 2/4 pending
[5/6] CI: `unit` failed → attributed to this PR → flaky assert corrected, pushed 9ab0cd1
[5/6] CI: `e2e` failed → attributed to main (fails at 77f2a1c too) → asked, comment posted
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ ef01234
```

The `[mode]` line reflects the flags in play — e.g. `PR only (no flags)`,
`--merge`, `--review`, `--resolve`, or `--auto (full hands-off)`. Phases that don't
run for the chosen mode are simply absent from the output.

On any halt, print: phase, reason, the artifact path the user should inspect, and 1–2 suggested next actions. On an `escalated` halt (business-rule conflict / unfixable CI), name exactly what needs a human decision.
