---
name: pr-autopilot
description: Orchestrates the full lifecycle of a Pull Request — creation, multi-agent code review, automated review response with code fixes, CI monitoring, and auto-merge. Use when the user wants to ship a branch end-to-end with minimal supervision (e.g. "open PR and merge", "/pr-autopilot", "ship this branch", "review and merge my branch"). Supports GitHub (gh) and GitLab (glab). Coordinates Reviewer and Author subagents via the Task tool.
argument-hint: "[--auto] [--review] [--resolve] [--merge] [--draft] [--max-iterations <N>] [--merge-strategy squash|merge|rebase] [--base <branch>] [--platform github|gitlab] [--ci-timeout <sec>] [--ci-poll-interval <sec>] [--title <text>] [--body <text>]"
---

# pr-autopilot

End-to-end PR pipeline: **create → (review → respond → re-review loop) → resolve conflicts & fix CI → wait for CI → merge**.

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
`[NITPICK]`), status tags (`✅ FIXED`, `🛑 REFUTED`, `⏸ DEFERRED`, `🤷 SKIPPED`),
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
| **PR + review + resolve** | `--resolve` | Phase 1 → Phase 2 → Phase 3 (Author fixes comments, conflicts and CI) → loop → STOP before merge. Add `--merge` to merge on green CI. |
| **Auto (full hands-off)** | `--auto` | Everything on: review + resolve + wait ALL CI + merge, no prompts. Resolves merge conflicts and fixes failing CI along the way. Halts or escalates only on a guardrail it must not cross. |

Rules that tie the flags together:

- `--resolve` **implies** `--review` — you cannot resolve comments without a review. Passing `--resolve` alone turns the Reviewer on too.
- `--merge` is what enables the merge. Without it (and without `--auto`), the pipeline always stops before merging, no matter how green CI is.
- `--auto` is shorthand for `--review --resolve --merge` plus a "never prompt for confirmation" semantic **and** the aggressive-resolution behavior: in `--auto` (and any `--resolve`) run, the Author resolves merge conflicts and fixes failing CI, not just review comments.
- `--draft` forces no merge even when `--merge`/`--auto` is set.

`--auto` does **not** weaken any guardrail: a fix that regresses tests, a conflict
that touches business logic, an unresolved BLOCKER, or a still-red required check
all halt or escalate. The merge step only executes when Phase 5 reports every
required check green AND the PR is `MERGEABLE`.

### All flags

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | `false` | Full hands-off. Turns on `--review`, `--resolve`, `--merge`, disables prompts, and lets the Author resolve conflicts + fix CI. |
| `--review` | `false` | Run the Reviewer subagent (inline comments). |
| `--resolve` | `false` | Run the Author subagent — addresses review comments, resolves merge conflicts, and fixes failing CI. Implies `--review`. |
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
   └─ --resolve ────────► PR → inline review → Author resolves comments,
        (implies review)   conflicts and CI → STOP before merge
                           (add --merge to merge on green CI)
```

Invocation examples:
- `pr-autopilot` → create the PR and stop
- `pr-autopilot --merge` → create PR + auto-merge on green CI (no review)
- `pr-autopilot --review` → create PR, post inline review, stop
- `pr-autopilot --resolve` → PR + review + Author resolves everything, stop before merge
- `pr-autopilot --resolve --merge` → PR + full resolve loop + merge on green CI
- `pr-autopilot --auto` → full hands-off; merges only when CI is green
- `pr-autopilot --auto --merge-strategy=rebase --max-iterations=3`

If no flags are present and the invocation is interactive, the orchestrator MAY
prompt once: "Which mode? [1] PR only (default)  [2] PR + merge  [3] PR + review
[4] PR + review + resolve  [5] Auto (full hands-off)". In non-interactive mode
with no flags, default to mode 1 (PR only) — create the PR and stop.

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
│      │                                                          │
│      ▼                                                          │
│  Phase 3: Author subagent (Task)    ──► response-summary.md     │
│      │     fixes review comments, resolves merge conflicts,     │
│      │     fixes failing CI, commits, pushes                    │
│      │     (escalates business-logic conflicts via groom-me)    │
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
the whole PR, not just comments: it also resolves merge conflicts and fixes red
CI, escalating to the user (via the `groom-me` skill) whenever a fix would touch a
business rule. Phase 6 only runs under `--merge`/`--auto`.

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

Route by the flags that are on (remember `--resolve` implies `--review`, and
`--auto` implies all three):

- **No `--review`, `--resolve`, `--merge` or `--auto`** → STOP here. Print the PR
  URL and exit. This is the default "PR only" mode.
- **`--review`/`--resolve`/`--auto`** → go to **Phase 2**.
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

## 5. Phase 3 — Author Subagent (Resolve everything: comments, conflicts, CI)

This phase only runs when `--resolve` (or `--auto`) is set. Otherwise the pipeline stops at the end of Phase 2.

The Author owns the **whole PR**, not just the review comments. Its job is to make
the PR clean and mergeable. It has three responsibilities, in this order:

1. **Review comments** — reply to and address every inline finding (§5.1).
2. **Merge conflicts** — if the PR conflicts with the base branch, resolve them (§5.2).
3. **Failing CI** — if any required check is red, diagnose and fix it (§5.3).

For (2) and (3) the Author must respect the **business-logic escalation
protocol** (§5.4): it never silently changes a business rule. When a conflict or a
CI fix would alter what the software decides, allows, blocks, or charges, it stops
and consults the user through the `groom-me` skill first.

**Hard requirement:** for every inline review comment, the Author must post an inline **reply** on that same comment, stating whether the FIX was applied, refuted, or deferred. A standalone "I addressed everything" PR comment is **not** acceptable.

### 5.1 How to reply to inline comments

#### GitHub — reply to a specific review comment

```bash
# Reply on an existing pull-request review comment:
gh api -X POST "repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<comment_id>/replies" \
  -f body="✅ FIXED in <commit_sha> — switched to session.isAdmin guard."
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

The orchestrator parses these tags to validate that no BLOCKER got `SKIPPED`.

### 5.2 Resolve merge conflicts

If the PR conflicts with its base branch, the Author resolves the conflict on the
**feature branch** — never by rewriting the base, never with a blind `--force`.

**Mechanic (no history rewrite, no force-push):**

```bash
git fetch origin
git merge origin/<BASE>          # brings base into the feature branch
# → resolve each conflicted file, then:
git add <resolved files>
git commit --no-edit             # keep the standard merge-commit message
# verification gate (see §5.5) must pass, then:
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
3. **Escalate on business logic or hard conflicts** (§5.4). If the conflict is not
   an obvious mechanical merge, OR it touches a business rule that must not change,
   STOP and run `groom-me` before resolving. Do not pick a side of a business-rule
   conflict on your own.

If the conflict cannot be resolved safely (business rule unclear and the user is
unreachable in a non-interactive run), do **not** guess. Record it in the response
summary as `conflict: escalated` and halt.

### 5.3 Fix failing CI

If a required check is red, the Author diagnoses and fixes it — it does not just
surface the log and give up.

```bash
# GitHub — pull the failing job logs
gh pr checks <PR_NUMBER> --json name,status,conclusion,link
gh run view --log-failed                 # last failing run's failing steps

# GitLab
glab ci status
glab ci trace                            # trace the failing job
```

Workflow per failing check:

1. Read the failing job log; identify the root cause (failing test, lint/type
   error, build break, flaky infra).
2. **Reproduce locally** when the command is obvious from `package.json` /
   `pyproject.toml` / `Makefile` / CI config. Do **not** invent commands.
3. Fix the code (file-scoped). If the fix would change a business rule, escalate
   via `groom-me` first (§5.4).
4. Run the **verification gate** (§5.5) — the fix must not regress lint/types/tests.
5. Commit (`fix(JIRA-XXX): fix CI — <brief>`) and push.
6. Re-poll CI (this is the loop back from Phase 5). Repeat up to `--max-iterations`
   attempts, then escalate to the user with the remaining red checks.

If a check is red for a reason the Author cannot fix from the code (e.g. missing
secret, external outage, infra-only failure), it records `ci: escalated` with the
reason and halts — it never merges over a red required check, and never disables a
check to go green.

### 5.4 Business-logic escalation protocol (`groom-me`)

The Author must **never silently change a business rule.** When resolving a
conflict (§5.2) or fixing CI (§5.3), if the change would alter **what the software
decides, allows, blocks, or charges** — an `if`/`else`/`switch`, a guard clause, a
validation, an eligibility/pricing/permission/discount check, a state transition,
a threshold or limit, or anything in a `domain/`/`rules/`/`policy/`/business layer
— it STOPS and consults the user **before** making the change:

1. Invoke the `groom-me` skill (`Skill` tool, `skill: "groom-me"`). It runs a
   short, non-technical interview (one decision per question, via `AskUserQuestion`)
   that confirms the intended behavior in plain language.
2. Apply exactly what the user confirms — nothing assumed, nothing extra.
3. If `groom-me` is unavailable in the harness, fall back to asking the user
   directly with `AskUserQuestion`, framed in the same non-technical way.

In a non-interactive run where the user cannot be reached, a business-logic
conflict/fix is **not** auto-resolved: record it as `escalated` and halt with a
clear pointer to what needs a human decision. Mechanical conflicts (imports,
lockfiles, formatting, non-behavioral merges) and non-behavioral CI fixes do not
need `groom-me` — resolve those directly.

### 5.5 Author prompt template

```
You are the Author agent in the pr-autopilot pipeline. You are stateless.

PR: <PR_URL>
Platform: <github|gitlab>
PR number / MR iid: <PR_NUMBER>
Owner/repo (or project_id): <SLUG>
Branch: <BRANCH>  (you must commit and push to this branch)
Base: <BASE>
Iteration: <N>  of <MAX>
Trigger: <review | ci-fix>   (why you were spawned this round)
Review report: .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md   (present when Trigger=review)
Repo root: <CWD>

You own the whole PR, not just the comments. Make it clean and MERGEABLE. Do the
parts that apply this round, in this order: (A) review comments, (B) merge
conflicts, (C) failing CI.

GOLDEN RULE — never silently change a business rule.
Before you resolve a conflict or write a CI fix that would alter WHAT the software
decides, allows, blocks, or charges (an if/else/switch, a guard, a validation, an
eligibility/pricing/permission/discount check, a state transition, a threshold or
limit, or anything in a domain/rules/policy/business layer), STOP and confirm the
intended behavior with the user FIRST by invoking the `groom-me` skill (Skill tool,
skill: "groom-me"). Apply exactly what they confirm. If groom-me is unavailable,
ask directly with AskUserQuestion in the same plain, non-technical language. In a
non-interactive run where the user can't be reached, do NOT guess — record it as
`escalated` and halt. Mechanical changes (imports, lockfiles, formatting,
non-behavioral merges/fixes) do not need groom-me.

Before guessing at a conflict resolution, if the harness exposes a shared-memory
tool (e.g. a `supermemory` MCP or similar), search it for a prior decision about
the conflicting file or rule, scoped to the project's memory. A recorded decision
outranks a guess.

──────────────────────────────────────────────────────────────────────────────
(A) REVIEW COMMENTS  (only when Trigger=review; read review-report.md)
Read review-report.md — it contains every finding plus its `comment_id`.

For each finding:
  BLOCKER    — you MUST address. Either (a) apply a code fix, or (b) if the finding
               is factually wrong, REFUTE it with concrete evidence (cite the code
               that already handles the case). Refusing a BLOCKER without
               refutation is not allowed.
  SUGGESTION — apply if low-risk and within PR scope. Otherwise mark DEFERRED with
               a clear reason.
  NITPICK    — apply only if trivial; otherwise SKIPPED is acceptable.

Per finding, in order:
1. Make the code change (file-scoped; do not introduce unrelated edits).
2. Stage and commit using Conventional Commits + Jira when applicable:
     fix(JIRA-XXX): Address review iter-<N> — <brief>
   Capture the resulting commit SHA.
3. Post an inline REPLY on the corresponding `comment_id`:
     GitHub:
       gh api -X POST repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<comment_id>/replies \
         -f body="<status_tag> — <one-line explanation>\n\n<optional: snippet of new code>"
     GitLab:
       glab api -X POST projects/:id/merge_requests/<iid>/discussions/<discussion_id>/notes \
         -F body="<status_tag> — ..."
   The reply body MUST start with exactly one of:
     ✅ FIXED in <sha>   🛑 REFUTED   ⏸ DEFERRED   🤷 SKIPPED (NITPICK only)

   HUMANIZE BEFORE POSTING (mandatory): run each reply's natural-language
   explanation through the `humanizer` skill (Skill tool, skill: "humanizer").
   Keep the leading status tag, the SHA, and any code snippet exactly as drafted —
   humanize only the prose between them. Post the humanized reply, never the raw
   draft.

   Resolve the conversation if the platform supports it and the action is FIXED or
   REFUTED:
     gh api -X PATCH repos/{owner}/{repo}/pulls/comments/<comment_id> ... (resolve via GraphQL)
     glab api -X PUT  projects/:id/merge_requests/<iid>/discussions/<discussion_id>?resolved=true

──────────────────────────────────────────────────────────────────────────────
(B) MERGE CONFLICTS  (whenever the PR conflicts with base)
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
(C) FAILING CI  (whenever a required check is red)
     gh pr checks <PR_NUMBER> --json name,status,conclusion,link
     gh run view --log-failed          # GitHub — failing steps of the last run
     glab ci status && glab ci trace    # GitLab
Per failing check:
  1. Read the log, find the root cause.
  2. Reproduce locally when the command is obvious from package.json /
     pyproject.toml / Makefile / CI config. Do NOT invent commands.
  3. Fix the code (file-scoped). Business-rule fix → GOLDEN RULE (groom-me) first.
  4. Run the VERIFICATION GATE (below). Commit `fix(JIRA-XXX): fix CI — <brief>`.
If a check is red for something you can't fix from code (missing secret, external
outage, infra-only failure), record `ci: escalated` with the reason and halt.
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
fixed_count: <int>
deferred_count: <int>
refuted_count: <int>
skipped_count: <int>
conflict: none | resolved | escalated
ci: green | fixed | escalated | not-run
groom_me_consultations: <int>
push_sha: <sha pushed, or "n/a" if not pushed>
verification: pass | fail | partial
---

# Author Response — iteration <N>

## Per-finding actions

### [BLOCKER] <title>
- comment_id: <id>
- Action: FIXED | REFUTED
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

## CI fixes
- Status: green | fixed | escalated | not-run
- Checks fixed: <name → root cause → fix commit>
- Escalated: <check name + why, or "n/a">

## Verification
- lint: pass | fail | not-run (<reason>)
- type-check: pass | fail | not-run
- tests: pass | fail | not-run
```

### 5.6 Orchestrator post-processing

- Read `response-summary.md`.
- If `verification: fail` → halt, surface logs to user, **do not** loop, **do not** merge.
- If `conflict: escalated` or `ci: escalated` → halt and surface exactly what needs a human decision (the Author already consulted `groom-me` where it could). Do **not** merge.
- Validate: every BLOCKER must have `Action: FIXED` or `REFUTED`. Any BLOCKER with `DEFERRED`/`SKIPPED` → halt and escalate (this is a guardrail violation).
- If everything green → increment iteration counter, return to **Phase 2** with iteration N+1.
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
    - **`--resolve`/`--auto` on** → loop back to **Phase 3** with `Trigger=ci-fix`. The Author reads the failing logs, fixes the code (escalating business-logic fixes via `groom-me`), pushes, and CI is re-polled. Bounded by `--max-iterations` CI-fix attempts; after that, surface the remaining red checks and escalate to the user. **Never merge over a red check.**
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
  conflict on the feature branch (merge base in, §5.2), consulting `groom-me` for
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
| CI fails, `--resolve`/`--auto` on | Author fixes it (Phase 3, `Trigger=ci-fix`), re-poll; escalate after `--max-iterations` |
| CI fails, resolve off | Surface failing job logs, stop |
| Merge conflict, `--resolve`/`--auto` on | Author resolves on the feature branch (merge base in, §5.2); business-rule conflicts go through `groom-me` first |
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
iter-1/review-report.md
iter-1/response-summary.md
iter-2/review-report.md
iter-2/response-summary.md
ci/last-poll.json
merge.json                       # post-merge metadata
```

`state.json.status` transitions:
`created → reviewing → responding → resolving_conflict → fixing_ci → ci_pending → merging → merged`
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

# Full review + resolve loop (fixes comments, conflicts, CI), stop before merge
pr-autopilot --resolve

# Full resolve loop + merge on green CI
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
[3/6] Author iter 1   → 2 fixed, 1 deferred, replies posted, pushed abc1234
[3/6] Author iter 1   → conflict in `pricing.ts` resolved (merged base, groom-me confirmed) def5678
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: waiting… 2/4 pending
[5/6] CI: `unit` failed → Author fix iter 1: flaky assert corrected, pushed 9ab0cd1
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ ef01234
```

The `[mode]` line reflects the flags in play — e.g. `PR only (no flags)`,
`--merge`, `--review`, `--resolve`, or `--auto (full hands-off)`. Phases that don't
run for the chosen mode are simply absent from the output.

On any halt, print: phase, reason, the artifact path the user should inspect, and 1–2 suggested next actions. On an `escalated` halt (business-rule conflict / unfixable CI), name exactly what needs a human decision.
