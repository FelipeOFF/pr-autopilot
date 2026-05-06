---
name: pr-autopilot
description: Orchestrates the full lifecycle of a Pull Request — creation, multi-agent code review, automated review response with code fixes, CI monitoring, and auto-merge. Use when the user wants to ship a branch end-to-end with minimal supervision (e.g. "open PR and merge", "/pr-autopilot", "ship this branch", "review and merge my branch"). Supports GitHub (gh) and GitLab (glab). Coordinates Reviewer and Author subagents via the Task tool.
---

# pr-autopilot

End-to-end PR pipeline: **create → review → respond → re-review (loop) → wait for CI → merge**.

This skill is **rigid**. Follow the phases in order. Do not skip the verification gates between phases. Coordinate subagents via the `Task` tool (or `Agent` tool depending on harness). Persist intermediate artifacts to `.pr-autopilot/<pr-number>/` so iterations and re-runs are recoverable.

---

## 1. Flags / Parameters

Parse these from the user's invocation. Apply defaults when missing.

| Flag | Default | Description |
|------|---------|-------------|
| `--review` | `true` | Run Reviewer/Author subagent loop. `false` skips straight to CI + merge. |
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

Invocation patterns:
- `pr-autopilot` → all defaults
- `pr-autopilot --no-merge` → review only, leave PR open
- `pr-autopilot --review=false` → just create PR + auto-merge on green CI
- `pr-autopilot --merge-strategy=rebase --max-iterations=3`

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

## 4. Phase 2 — Reviewer Subagent

Spawn one subagent per iteration. Use the `Task` tool with `subagent_type: "general-purpose"` (or `code-reviewer` if available in the harness).

### 4.1 Reviewer prompt template

```
You are the Reviewer agent in the pr-autopilot pipeline. You are stateless and have
no prior context — everything you need is below.

PR: <PR_URL>
Base: <BASE>
Head: <BRANCH>
Iteration: <N> of <MAX>
Repo root: <CWD>

YOUR TASK
Read the full diff (run: git diff <BASE>...<BRANCH>) and the changed files in their
current state. Evaluate against:
- Correctness and edge cases
- Security (injection, secret leakage, authz bypass, OWASP-class issues)
- Performance (N+1, unbounded loops, blocking I/O on hot paths)
- Code quality (naming, dead code, premature abstraction, missing error paths
  at trust boundaries)
- Consistency with surrounding codebase patterns
- Test coverage proportional to risk

For each finding, classify as exactly one of:
  BLOCKER    — must be fixed before merge (bug, security, regression, broken contract)
  SUGGESTION — should likely be fixed; reviewer judgment improves quality
  NITPICK    — optional/aesthetic; safe to ignore
  APPROVED   — top-level marker only, used when there are zero BLOCKERs

OUTPUT
Write a single file at .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md with this
exact structure:

---
verdict: APPROVED | CHANGES_REQUESTED
blocker_count: <int>
suggestion_count: <int>
nitpick_count: <int>
---

# Review — iteration <N>

## Summary
<2–4 sentences>

## Findings

### [BLOCKER] <one-line title>
- File: `path/to/file.ts:42`
- Problem: <what is wrong>
- Why it blocks: <consequence>
- Suggested fix: <concrete direction; code if useful>

### [SUGGESTION] <title>
... (same shape)

### [NITPICK] <title>
... (same shape)

## Verdict
APPROVED   ← if and only if blocker_count == 0
or
CHANGES_REQUESTED

Be specific. Cite exact file paths and line numbers. Do not write speculative findings
— if you are not sure something is broken, downgrade it to SUGGESTION or omit it.
```

### 4.2 Orchestrator post-processing

After the Reviewer returns, parse the front-matter of `review-report.md`:

- `verdict: APPROVED` and `blocker_count: 0` → jump to **Phase 5**
- `verdict: CHANGES_REQUESTED` → proceed to **Phase 3**
- Malformed front-matter → re-spawn Reviewer once with explicit format reminder; on second failure, escalate to user

---

## 5. Phase 3 — Author Subagent (Response + Fixes)

### 5.1 Author prompt template

```
You are the Author agent in the pr-autopilot pipeline. You are stateless.

PR: <PR_URL>
Branch: <BRANCH> (you must commit and push to this branch)
Iteration: <N>
Review report: .pr-autopilot/<PR_NUMBER>/iter-<N>/review-report.md
Repo root: <CWD>

YOUR TASK
Read the review report. For each finding:

  BLOCKER    — you MUST address. Either:
                 (a) apply a code fix, or
                 (b) if the finding is factually wrong, refute it with concrete
                     evidence (cite the code that already handles the case).
                 Refusing a BLOCKER without refutation is not allowed.

  SUGGESTION — apply the fix if it is low-risk and aligned with the PR scope.
               Defer if it expands scope, requires design decisions, or is better
               handled in a follow-up — explain why and log as tech debt.

  NITPICK    — apply only if trivial; otherwise ignore.

WORKFLOW
1. Make code changes file by file. Do not introduce unrelated edits.
2. Run the project's lint + type-check + tests if commands are obvious from
   package.json / pyproject.toml / Makefile. Do not invent commands.
3. Commit using Conventional Commits + Jira if branch matches `<type>/<JIRA>/...`:
     fix(JIRA-XXX): Address review iter-<N> — <brief>
   One commit per logical fix is preferred; squash on merge will collapse them.
4. Push to origin.

OUTPUT
Write .pr-autopilot/<PR_NUMBER>/iter-<N>/response-summary.md with:

---
fixed_count: <int>
deferred_count: <int>
refuted_count: <int>
---

# Author Response — iteration <N>

## Per-finding actions

### [BLOCKER] <title from review>
- Action: FIXED | REFUTED
- Commit: <sha or "n/a">
- Notes: <what changed or why finding was wrong>

### [SUGGESTION] <title>
- Action: FIXED | DEFERRED
- Commit / tech-debt note: ...

(repeat for all findings; NITPICKs may be grouped)

## Verification
- lint: pass | fail | not-run (<reason>)
- type-check: pass | fail | not-run
- tests: pass | fail | not-run

Do not push if lint/type/tests regressed. Instead, write the failure into the
response summary and stop.
```

### 5.2 Orchestrator post-processing

- Read `response-summary.md`.
- If verification shows regression → halt, surface logs to user, **do not** loop.
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
- Hard stop at `CI_TIMEOUT` seconds → ask user.
- Terminal states:
  - All `success`/`neutral` → proceed to **Phase 6**.
  - Any `failure`/`cancelled`/`timed_out` → fetch failing job logs (`gh run view --log-failed` or `glab ci trace`), surface the last ~80 lines, **stop**. Do not retry automatically.
  - Mix of pending + success → keep polling.

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
# Standard: open PR, review loop, merge on green CI
pr-autopilot

# Skip review entirely, just open and merge when CI passes
pr-autopilot --review=false

# Open + review, but stop before merge (e.g. for human sign-off)
pr-autopilot --no-merge

# Tighter loop, rebase merge
pr-autopilot --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
pr-autopilot --draft

# Override base branch
pr-autopilot --base=develop
```

---

## 11. Output to User

Keep terminal output terse. Per phase, emit one line:

```
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION)
[3/6] Author iter 1 → 2 fixed, 1 deferred, pushed abc1234
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ def5678
```

On any halt, print: phase, reason, the artifact path the user should inspect, and 1–2 suggested next actions.
