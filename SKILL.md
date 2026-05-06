---
name: pr-autopilot
description: Orchestrates the full lifecycle of a Pull Request — creation, multi-agent code review, automated review response with code fixes, CI monitoring, and auto-merge. Use when the user wants to ship a branch end-to-end with minimal supervision (e.g. "open PR and merge", "/pr-autopilot", "ship this branch", "review and merge my branch"). Supports GitHub (gh) and GitLab (glab). Coordinates Reviewer and Author subagents via the Task tool.
argument-hint: "[--auto] [--review=true|false] [--resolve=true|false] [--no-merge] [--draft] [--max-iterations <N>] [--merge-strategy squash|merge|rebase] [--base <branch>] [--platform github|gitlab] [--ci-timeout <sec>] [--ci-poll-interval <sec>] [--title <text>] [--body <text>]"
---

# pr-autopilot

End-to-end PR pipeline: **create → review → respond → re-review (loop) → wait for CI → merge**.

This skill is **rigid**. Follow the phases in order. Do not skip the verification gates between phases. Coordinate subagents via the `Task` tool (or `Agent` tool depending on harness). Persist intermediate artifacts to `.pr-autopilot/<pr-number>/` so iterations and re-runs are recoverable.

---

## 1. Flags / Parameters

Parse these from the user's invocation. Apply defaults when missing.

### Mode flags (the user picks one of four modes)

| Mode | Flags | Pipeline |
|------|-------|----------|
| **PR only** | `--review=false` | Phase 1 → Phase 5 → Phase 6 |
| **PR + review** | `--review=true --resolve=false` | Phase 1 → Phase 2 (Reviewer posts inline comments) → STOP |
| **PR + review + resolve** *(default)* | `--review=true --resolve=true` | Phase 1 → Phase 2 → Phase 3 (Author replies inline + commits) → loop → Phase 5 → Phase 6 |
| **Auto (full hands-off)** | `--auto` | Same as mode 3, but explicit: orchestrator runs the full pipeline end-to-end without prompting, waits for ALL CI checks to pass, and only then merges. Halts on any verification or CI failure. |

`--auto` is shorthand for `--review=true --resolve=true --no-merge=false`, plus an
explicit "do not interrupt for confirmation" semantic. It does **not** weaken any
guardrail: failing tests, failing CI, failing verification, or unresolved BLOCKERs
still halt the pipeline. The merge step only executes when Phase 5 reports all
checks green AND the PR is `MERGEABLE`.

### All flags

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | `false` | Enable fully autonomous mode (review + resolve + wait CI + merge). Sets `--review=true`, `--resolve=true`, `--no-merge=false` and disables interactive prompts. |
| `--review` | `true` | Run the Reviewer subagent. `false` skips straight to CI + merge. |
| `--resolve` | `true` | Run the Author subagent that addresses each review comment. Requires `--review=true`. |
| `--max-iterations` | `2` | Max review→respond cycles before forcing escalation to user. |
| `--merge-strategy` | `squash` | One of `squash`, `merge`, `rebase`. |
| `--base` | auto-detect | Target branch. Defaults to repo default branch (`main`/`master`/`trunk`). |
| `--draft` | `false` | Open PR as draft. Skip auto-merge if true. |
| `--platform` | auto-detect | `github` or `gitlab`. Auto-detected from remote URL. |
| `--ci-timeout` | `1800` | Seconds to wait for checks before bailing. |
| `--ci-poll-interval` | `30` | Seconds between status polls. Backs off to 60s after 10 polls. |
| `--no-merge` | `false` | Stop after review approval; do not merge. |
| `--title` | auto-generated | Override generated title. |
| `--body` | auto-generated | Override generated body. |

### Invocation flow (decision tree)

```
pr-autopilot
   │
   ├─ --auto ─────────────────────► full hands-off: PR → review → resolve →
   │                                 wait ALL CI → merge (halts on any failure)
   │
   ├─ --review=false ─────────────► PR only (CI + merge)
   │
   └─ --review=true (default)
            │
            ├─ --resolve=false ───► PR + inline review (stops, waits for human)
            │
            └─ --resolve=true ────► PR + inline review + Author addresses each
                  (default)          comment + reply per comment + CI + merge
```

Invocation examples:
- `pr-autopilot --auto` → full hands-off pipeline; merges only when CI is green
- `pr-autopilot` → default pipeline (review + resolve + merge)
- `pr-autopilot --review=false` → just create PR + auto-merge on green CI
- `pr-autopilot --review=true --resolve=false` → create PR, post inline review, stop
- `pr-autopilot --no-merge` → full review/resolve loop, do not merge
- `pr-autopilot --auto --merge-strategy=rebase --max-iterations=3`

If neither `--auto` nor explicit mode flags are present and the invocation is
interactive, the orchestrator MAY prompt once: "Which mode? [1] PR only
[2] PR + review  [3] PR + review + resolve (default)  [4] Auto (full hands-off)".
In non-interactive mode, default to mode 3.

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
│      │     (applies fixes, commits, pushes)                     │
│      ▼                                                          │
│  Phase 4: Loop guard                                            │
│      │   if Reviewer not APPROVED and iter < max → back to P2   │
│      │   if iter == max → escalate to user                      │
│      ▼                                                          │
│  Phase 5: CI polling (gh/glab)                                  │
│      │                                                          │
│      ▼                                                          │
│  Phase 6: Auto-merge                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Subagents are stateless.** Each invocation gets a self-contained prompt with: PR number, diff, base ref, and the path to the artifact it must write. Never delegate "understanding" — the orchestrator reads each artifact and decides next phase.

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

If `--review=false` → jump to **Phase 5**.

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

- `verdict: APPROVED` and `blocker_count: 0` → jump to **Phase 5**.
- `verdict: CHANGES_REQUESTED` and `--resolve=false` → STOP (mode "PR + review"). Print the PR URL and exit.
- `verdict: CHANGES_REQUESTED` and `--resolve=true` → proceed to **Phase 3**.
- Malformed front-matter, or any finding without a `comment_id` → re-spawn Reviewer once with explicit format reminder; on second failure, escalate to user.

---

## 5. Phase 3 — Author Subagent (Inline replies + Fixes)

This phase only runs when `--resolve=true` (default). Otherwise the pipeline stops at the end of Phase 2.

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

### 5.2 Author prompt template

```
You are the Author agent in the pr-autopilot pipeline. You are stateless.

PR: <PR_URL>
Platform: <github|gitlab>
PR number / MR iid: <PR_NUMBER>
Branch: <BRANCH>  (you must commit and push to this branch)
Iteration: <N>
Review report: .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md
Repo root: <CWD>

YOUR TASK
Read review-report.md. It contains every finding plus its `comment_id`.

For each finding:

  BLOCKER    — you MUST address. Either:
                 (a) apply a code fix, or
                 (b) if the finding is factually wrong, REFUTE it with concrete
                     evidence (cite the code that already handles the case).
               Refusing a BLOCKER without refutation is not allowed.

  SUGGESTION — apply if low-risk and within PR scope. Otherwise mark DEFERRED
               with a clear reason.

  NITPICK    — apply only if trivial; otherwise SKIPPED is acceptable.

WORKFLOW (per finding, in order)

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
     ✅ FIXED in <sha>
     🛑 REFUTED
     ⏸ DEFERRED
     🤷 SKIPPED   (only valid for NITPICK)

   Resolve the conversation if the platform supports it and the action is
   FIXED or REFUTED:
     gh api -X PATCH repos/{owner}/{repo}/pulls/comments/<comment_id> ... (resolve via GraphQL)
     glab api -X PUT  projects/:id/merge_requests/<iid>/discussions/<discussion_id>?resolved=true

4. After ALL findings are processed, push the branch:
     git push origin <BRANCH>

VERIFICATION GATE (run BEFORE pushing)
Detect and run, when commands are obvious from package.json / pyproject.toml /
Makefile / etc. Do NOT invent commands.
- lint
- type-check
- tests

If any of them regress vs. the pre-iteration baseline, do NOT push and do NOT
post replies that claim FIXED. Instead, write a failure record into the
response summary and stop.

OUTPUT
Write .pr-autopilot/<PR_NUMBER>/iter-<N>/response-summary.md:

---
fixed_count: <int>
deferred_count: <int>
refuted_count: <int>
skipped_count: <int>
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

## Verification
- lint: pass | fail | not-run (<reason>)
- type-check: pass | fail | not-run
- tests: pass | fail | not-run
```

### 5.3 Orchestrator post-processing

- Read `response-summary.md`.
- If `verification: fail` → halt, surface logs to user, **do not** loop, **do not** merge.
- Validate: every BLOCKER must have `Action: FIXED` or `REFUTED`. Any BLOCKER with `DEFERRED`/`SKIPPED` → halt and escalate (this is a guardrail violation).
- If everything green → increment iteration counter, return to **Phase 2** with iteration N+1.
- After `MAX_ITERATIONS` cycles still not APPROVED → escalate: print summary of remaining BLOCKERs and ask user how to proceed (force merge / abort / extend iterations).

---

## 6. Phase 5 — CI Polling

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
  - **All required checks `success`/`neutral`** → proceed to **Phase 6**.
  - Any `failure`/`cancelled`/`timed_out` → fetch failing job logs (`gh run view --log-failed` or `glab ci trace`), surface the last ~80 lines, **stop**. Do not retry automatically. **Never merge.**
  - Mix of pending + success → keep polling. **Never merge while any required check is still pending or queued.**

`--auto` does not relax any of these rules — its sole effect is to skip
human-confirmation prompts. The merge step in Phase 6 is gated on:
1. `verdict: APPROVED` (or `--review=false`)
2. Every required check returned a non-failing terminal state
3. `mergeable=MERGEABLE` (no conflicts, branch protection satisfied)

If any of the three is missing, `--auto` halts with the failing condition.

### Mergeability check (must also pass)

```bash
# GitHub
gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus
# states: MERGEABLE / CONFLICTING / UNKNOWN
```

`CONFLICTING` → stop, ask user to resolve. Do not attempt auto-rebase.

---

## 7. Phase 6 — Merge

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

Skip merge if `--no-merge` or `--draft`. Update `state.json` to `merged` and report PR URL + merge SHA to the user.

---

## 8. Error & Edge Cases

| Situation | Action |
|-----------|--------|
| PR already exists | Reuse PR number, skip creation |
| Working tree dirty | Ask user to commit; do not auto-stash |
| Push rejected (non-fast-forward) | Stop, ask user — do not force-push |
| Author agent breaks lint/tests | Halt loop, surface logs |
| Reviewer never approves (max iter hit) | Escalate with remaining BLOCKERs summary |
| CI fails | Surface failing job logs, stop |
| Merge conflict | Stop, ask user — never auto-resolve |
| Required reviewers / branch protection blocks merge | Stop, surface the rule that blocks |
| `gh`/`glab` not installed | Abort preflight with install hint |
| Detached HEAD | Abort preflight |
| Remote is neither GitHub nor GitLab | Abort preflight |
| Unsigned commit rejected by hook | Surface hook output, do not retry with `--no-verify` |
| Subagent returns malformed artifact | Retry once with explicit format reminder, then escalate |

**Never** use `--no-verify`, `--force`, or `--force-push`. **Never** silently skip a BLOCKER.

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
`created → reviewing → responding → ci_pending → merging → merged`
or any → `aborted` with `reason`.

Re-running the skill on the same branch reads state and resumes at the correct phase.

---

## 10. Invocation Examples

```
# Fully autonomous: review + resolve + wait CI + merge
pr-autopilot --auto

# Standard (default): open PR, review loop, merge on green CI
pr-autopilot

# Open PR, post inline review, stop (human will resolve)
pr-autopilot --review=true --resolve=false

# Skip review entirely, just open and merge when CI passes
pr-autopilot --review=false

# Open + full review loop, but stop before merge (human sign-off)
pr-autopilot --no-merge

# Auto mode with tighter loop and rebase merge
pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
pr-autopilot --draft

# Override base branch
pr-autopilot --base=develop
```

---

## 11. Output to User

Keep terminal output terse. Per phase, emit one line:

```
[mode] --auto (full hands-off)
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 inline comments posted
[3/6] Author iter 1   → 2 fixed, 1 deferred, replies posted, pushed abc1234
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: waiting… 2/4 pending
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ def5678
```

On any halt, print: phase, reason, the artifact path the user should inspect, and 1–2 suggested next actions.
