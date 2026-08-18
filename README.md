# pr-autopilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-7c3aed)](https://docs.claude.com/en/docs/claude-code)
[![Platforms](https://img.shields.io/badge/platforms-GitHub%20%7C%20GitLab-blue)]()

> 🇧🇷 [Leia em Português](./README.pt-BR.md)

A [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) that orchestrates the **full lifecycle of a Pull Request** with multiple coordinated subagents.

**Create → Review → Triage every comment → Respond → Re-review → Resolve conflicts & fix CI → Wait for CI → Merge.** Hands-off.

**Opt-in by default.** Every stage is off unless you ask for it. Bare `pr-autopilot` just opens the PR and stops. You switch on each stage with a flag (`--review`, `--resolve`, `--merge`) or turn them all on at once with `--auto`.

---

## What it does

`pr-autopilot` turns a long, manual PR ritual into a single command. It spawns a **Reviewer** subagent that audits your diff and an **Author** subagent that clears everything standing between the branch and a clean merge: every comment already on the PR (yours, your teammates', Copilot's, CodeRabbit's, Sonar's), merge conflicts, and failing CI. It loops until the PR is green, then merges.

Two things it will not do on its own. When a change would touch a **business rule**, the Author stops and confirms the intended behavior with you first, via the [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) skill. And when CI is red for a reason that predates your branch, it never patches around the failure — it asks before writing "this pipeline is broken for another reason" on your PR, and says it once, never twice.

```
┌──────────────────────────────────────────────────────────────┐
│  pr-autopilot (orchestrator)                                 │
│                                                              │
│  ① Preflight + PR creation                                   │
│        │                                                     │
│  ② Reviewer subagent  ──► review-report.md                   │
│        │                                                     │
│  ③ Author subagent    ──► pr-feedback.md + response-summary  │
│        │      triages EVERY comment on the PR (human + bot),  │
│        │      fixes them, resolves conflicts, attributes and  │
│        │      fixes CI  (business rules → groom-me first)     │
│  ④ Loop until APPROVED or max-iterations hit                 │
│        │                                                     │
│  ⑤ Poll CI checks  (red + --resolve → back to ③)            │
│        │                                                     │
│  ⑥ Auto-merge — only with --merge / --auto                   │
└──────────────────────────────────────────────────────────────┘
```

Stages ②–⑥ are opt-in. With no flags the run ends after ①.

## Features

- **Opt-in stages** — every flag defaults to `false`. Bare `pr-autopilot` opens the PR and stops; you turn on review, resolve, and merge as you need them.
- **Auto title + body** from commits and diff, following Conventional Commits + Jira.
- **Multi-agent review loop** with structured findings: `BLOCKER`, `SUGGESTION`, `NITPICK`, `APPROVED`.
- **Writes like a person, codes like a lazy senior** — every word posted to the PR goes through [`humanizer`](https://github.com/FelipeOFF/skills/tree/main/skills/humanizer) and every line of code through [`ponytail`](https://github.com/FelipeOFF/skills/tree/main/skills/ponytail). No `✅ FIXED` stamps, no `[BLOCKER]` brackets, no emoji openers: comments read like a teammate wrote them, and the machine state rides in an invisible HTML marker. Both skills are also restated inside the skill, so a bare harness without them behaves the same.
- **Reviews for over-engineering, not just bugs** — the Reviewer carries the ponytail lens: an abstraction with one caller, a dependency added for three lines, a helper reimplemented when the repo already has one. "Delete this" is a valid finding.
- **Author with veto power** — the Author can refute a wrong BLOCKER with evidence instead of blindly applying it.
- **Reads every comment on the PR, not just its own** — with `--resolve`, the Author pulls inline comments, top-level comments and review verdicts from humans *and* bots (Copilot, CodeRabbit, Sonar), classifies each one (critique / question / noise / already handled), infers a severity, and replies inline to each in plain language. Its own past replies are read as state, so it never loops answering itself.
- **Resolves the whole PR** — with `--resolve`/`--auto`, the Author also resolves **merge conflicts** (merging base into the feature branch, no force-push) and **fixes failing CI** (reads the logs, patches the code, re-runs verification, pushes).
- **Attributes CI failures before touching them** — it checks whether the failing file is in your diff, whether the same job fails on the base branch and on other open PRs, and whether the log shows a missing secret or a network timeout. Your breakage gets fixed. Someone else's never gets papered over with a skipped test or a random pin.
- **Says "this isn't my PR's fault" only with your permission** — and only once. Before posting that comment it asks you, showing the exact text; it looks for its own `<!-- pr-autopilot:ci-triage:<check> -->` marker so a re-run never double-posts; and in `--auto` it stays quiet and hands you the drafted text instead.
- **Business-rule guardrail** — before a comment, a conflict resolution or a CI fix changes what the software decides, allows, blocks, or charges, the Author confirms the intended behavior with you via the [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) skill. A reviewer *asking* for the change is the input to that conversation, not a substitute for it. It never silently ships a decision you didn't make.
- **Verification gates** — lint, type-check and tests must stay green before any push.
- **CI polling** with adaptive backoff, configurable timeout, and real failure logs surfaced to the user.
- **Resumable state** — every artifact is persisted under `.pr-autopilot/<PR>/`. Re-running picks up at the right phase.
- **GitHub & GitLab** out of the box (`gh` / `glab`).
- **Safe by default** — never `--no-verify`, never a blind `--force`, never a silent business-rule change.

## Requirements

| Tool | Why |
|------|-----|
| [Claude Code](https://docs.claude.com/en/docs/claude-code) | The agent runtime |
| `git` | Required |
| [`gh`](https://cli.github.com/) | For GitHub repos |
| [`glab`](https://gitlab.com/gitlab-org/cli) | For GitLab repos |
| `jq` | Used in a few CLI calls |

## Installation

### Recommended — one command with `npx`

```bash
# User-level install (available in every project)
npx github:FelipeOFF/pr-autopilot

# Project-level install (only this repo)
npx github:FelipeOFF/pr-autopilot --project

# Other actions
npx github:FelipeOFF/pr-autopilot --dry-run     # show what would be written
npx github:FelipeOFF/pr-autopilot --uninstall   # remove installed copy
npx github:FelipeOFF/pr-autopilot --help
```

The installer copies `SKILL.md` into `~/.claude/skills/pr-autopilot/`
(or `./.claude/skills/pr-autopilot/` with `--project`). After install, run
`/reload-plugins` inside Claude Code (or restart the session) so the skill
gets picked up.

### With the `skills` CLI — `npx skills add`

If you use the [`skills`](https://www.npmjs.com/package/skills) CLI
(`vercel-labs/skills`), add this skill straight from GitHub:

```bash
# Project-level install (./.claude/skills/) — this is the default
npx skills add FelipeOFF/pr-autopilot

# User-level install (~/.claude/skills/, available in every project)
npx skills add FelipeOFF/pr-autopilot -g

# Manage installed skills
npx skills list                 # list installed skills
npx skills update pr-autopilot  # pull the latest SKILL.md
npx skills update               # update every skill the CLI manages
npx skills remove pr-autopilot  # uninstall
```

`npx skills add` pulls the repo and links `SKILL.md` into the skills directory.
Because the CLI tracks what it installs, `npx skills update` can later refresh
it in place — unlike a manual copy. As with the other methods, run
`/reload-plugins` inside Claude Code afterward so `/pr-autopilot` shows up.

### Manual (no Node required)

```bash
# User-level
mkdir -p ~/.claude/skills/pr-autopilot
curl -o ~/.claude/skills/pr-autopilot/SKILL.md \
  https://raw.githubusercontent.com/FelipeOFF/pr-autopilot/main/SKILL.md

# OR project-level
mkdir -p .claude/skills/pr-autopilot
cp SKILL.md .claude/skills/pr-autopilot/
```

When you start typing `/pr-autopilot` in Claude Code, the available flags
(`--auto`, `--review`, `--resolve`, `--merge`, `--draft`, …) appear inline
thanks to the `argument-hint` declared in the skill's front-matter — same
pattern GSD uses.

## Development workflow

This repository **is** the development source of the skill. Clone it,
iterate on `SKILL.md`, then sync to your global Claude Code skills dir:

```bash
git clone https://github.com/FelipeOFF/pr-autopilot.git
cd pr-autopilot

make check       # validate SKILL.md front-matter
make dry-run     # see what would be installed
make sync        # install/update ~/.claude/skills/pr-autopilot/
make diff        # diff repo SKILL.md vs installed copy
make uninstall   # remove the global install
```

After `make sync`, run `/reload-plugins` inside Claude Code (or restart the
session) to pick up the updated skill.

## Modes

Everything is opt-in — compose the flags you want (each defaults to `false`):

| Mode | How to invoke | What happens |
|------|---------------|--------------|
| **PR only** *(default, no flags)* | `/pr-autopilot` | Creates the PR, prints the URL, stops. Nothing else runs. |
| **PR + merge** | `/pr-autopilot --merge` | Creates PR, waits for CI, merges. No review. |
| **PR + review** | `/pr-autopilot --review` | Creates PR, posts **inline** review comments, stops |
| **Resolve what's already there** | `/pr-autopilot --resolve` | Skips the AI review. The Author triages every comment already on the PR — human and bot — fixes what's actionable, resolves conflicts, fixes CI, stops before merge |
| **Review + resolve** | `/pr-autopilot --review --resolve` | Creates PR, posts an inline review, then the Author resolves that review *plus* everything else on the PR, loops, stops before merge (add `--merge` to merge) |
| **Auto (full hands-off)** | `/pr-autopilot --auto` | Everything on, never prompts. Resolves conflicts and fixes CI. Waits for **all** CI checks. Merges only when everything is green. Halts or escalates on any guardrail. |

Notes:

- `--resolve` is independent of `--review`. Alone, it works the feedback the PR already has without adding a review of its own — that's the mode for a PR a human already reviewed.
- `--merge` is what enables the merge; without it (or `--auto`) the run always stops before merging.
- `--auto` is shorthand for `--review --resolve --merge` plus "never ask me anything" — but it never relaxes a guardrail: failing tests, a business-rule conflict, an open BLOCKER, or a red check all halt or escalate.
- No prompts means no consent. Anything needing your explicit yes — a business-rule change, or a comment claiming CI is red for reasons outside your PR — is recorded as escalated in `--auto`, never done silently.

## Usage

From any branch with commits to ship:

```bash
# Default (no flags): open the PR and stop
/pr-autopilot

# Fully autonomous: review + resolve (comments + conflicts + CI) + wait CI + merge
/pr-autopilot --auto

# Create and auto-merge on green CI, no review
/pr-autopilot --merge

# Open PR, post inline review, stop (human will resolve)
/pr-autopilot --review

# Work the feedback the PR already has (teammates, Copilot, CodeRabbit) + conflicts
# + CI, without posting a new AI review
/pr-autopilot --resolve

# Post a review first, then resolve it plus everything else
/pr-autopilot --review --resolve

# Resolve existing feedback + merge on green CI
/pr-autopilot --resolve --merge

# Auto mode with tighter loop and rebase merge
/pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
/pr-autopilot --draft
```

### Flags

Every boolean flag defaults to `false` — pass it (bare, or `=true`) to turn the stage on.

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | `false` | Full hands-off: turns on `--review`, `--resolve`, `--merge`, never prompts, resolves conflicts + fixes CI. |
| `--review` | `false` | Run the Reviewer subagent (inline comments) |
| `--resolve` | `false` | Run the Author subagent — triages every comment already on the PR (human and bot), fixes what's actionable, resolves conflicts, fixes CI. Does **not** imply `--review`. |
| `--merge` | `false` | Enable auto-merge on green CI + `MERGEABLE`. Without it the run stops before merge. |
| `--max-iterations` | `2` | Max review→respond (and CI-fix) cycles |
| `--merge-strategy` | `squash` | `squash` \| `merge` \| `rebase` |
| `--base` | auto | Target branch |
| `--draft` | `false` | Open as draft (forces no merge) |
| `--ci-timeout` | `1800` | Seconds before bailing on CI |
| `--ci-poll-interval` | `30` | Seconds between polls |

### Inline review & inline replies

The Reviewer **never** posts a single bulk PR comment. Every finding is posted as an inline comment on the exact file + line. It opens with the words a reviewer says out loud — `Blocking:`, `Suggestion:`, `nit:` — and closes with an invisible marker that carries the severity for the pipeline:

```html
<!-- pr-autopilot:severity=blocker -->
```

The Author replies on each inline comment in plain language, and closes the reply with the action marker:

```html
<!-- pr-autopilot:action=fixed sha=abc1234 -->   code was changed
<!-- pr-autopilot:action=refuted -->             finding is wrong, with code evidence
<!-- pr-autopilot:action=deferred -->            acknowledged, follow-up planned
<!-- pr-autopilot:action=skipped -->             only allowed for NITPICKs
<!-- pr-autopilot:action=answered -->            it was a question; answered, nothing to change
```

The human reads a sentence; the pipeline reads the marker. That is what keeps the PR from looking like a bot filled in a form while the orchestrator still knows exactly what happened to each finding — and what lets the next iteration tell an already-handled thread from a new one.

The orchestrator validates that no BLOCKER ever ends up `deferred`/`skipped` — including BLOCKERs inferred from a human's `CHANGES_REQUESTED` review. A standing human block is never merged past, however green CI is.

Comments that came from a human or another bot get the same treatment. They arrive without severity markers, so the Author infers one: a comment attached to a `CHANGES_REQUESTED` review, or naming a bug, a security hole, data loss or a broken contract, is a `BLOCKER`; anything explicitly marked "nit" or "optional" is a `NITPICK`; the rest defaults to `SUGGESTION`. It never downgrades a finding a human used to block the PR.

### Conflicts & CI (with `--resolve` / `--auto`)

Beyond comments, the Author also clears whatever else blocks a clean merge:

- **Merge conflicts** — merges the base into the feature branch, resolves each file (reading the code, git history, and shared memory for prior decisions), commits, and pushes. No history rewrite, no force-push.
- **Failing CI, attributed first** — before touching anything, the Author decides whose failure it is. Is the failing file in this PR's diff? Does the same job fail on the base branch, or on other open PRs right now? Does the log show a missing secret, a registry 5xx, a runner OOM? A verdict of `unknown` counts as *yours* — it investigates its own diff rather than blaming the pipeline.
  - **Yours** → root-cause it from the log, reproduce locally when the command is obvious, patch the code, re-run lint/type/test, commit, push. Loops up to `--max-iterations`.
  - **Not yours** → it never papers over it. No skipped test, no random pin, no blind retry, no edited workflow. It offers to comment on the PR instead: it first searches for its own `<!-- pr-autopilot:ci-triage:<check> -->` marker so the point is made once and never repeated, then asks you — showing the exact text — and posts only on an explicit yes. In `--auto` or any non-interactive run it posts nothing and hands you the drafted comment.
- **Business-rule guardrail** — if acting on a comment, resolving a conflict or fixing CI would change an `if`/validation/threshold/pricing/permission or any domain decision, the Author pauses and confirms the intended behavior with you through the [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) skill before touching it. A reviewer asking for the change doesn't authorize it — their comment is what starts that conversation. In a non-interactive run it records the item as escalated and halts rather than guessing.

Full reference in [`SKILL.md`](./SKILL.md).

## How the agents talk to each other

The orchestrator never lets the agents talk directly. They communicate through **typed Markdown artifacts** with YAML front-matter, written under `.pr-autopilot/<PR>/iter-<N>/`:

- `review-report.md` — produced by the Reviewer. Contains `verdict`, `blocker_count`, list of findings. Absent when `--resolve` runs without `--review`.
- `pr-feedback.md` — produced by the Author before it writes any code. The inventory of every comment already on the PR: author, source, class, inferred severity, and whether it touches a business rule.
- `response-summary.md` — produced by the Author. Contains per-finding action (`FIXED`, `REFUTED`, `DEFERRED`, `ANSWERED`), conflict status, per-check CI attribution, commit SHAs, and verification results. These files are machine state and never get posted, which is why they keep the flat uppercase vocabulary the PR comments dropped.

The orchestrator parses the front-matter and decides the next phase. This makes every step **inspectable, replayable, and resumable.**

## Safety

- **Never bypasses hooks.** No `--no-verify`, no `--no-gpg-sign`.
- **Never blind force-pushes.** Conflicts are resolved by merging the base into the feature branch (no history rewrite). The only force allowed is `--force-with-lease` on the *feature* branch when you explicitly chose `--merge-strategy=rebase` — never on a protected branch.
- **Never silently changes a business rule.** A comment, conflict or CI fix that touches a domain decision goes through `groom-me` for your confirmation first.
- **Never speaks for you on the PR without asking.** Claiming a red check is someone else's fault is a social act with a cost. The Author asks first, shows you the exact text, checks its own marker so it never double-posts, and stays silent in `--auto`.
- **Never papers over a broken pipeline.** A failure it didn't cause is never made green by skipping a test, pinning a dependency at random, or editing the workflow.
- **Verification before push.** The Author refuses to push if lint/types/tests regressed.
- **No silent BLOCKER skips.** Either the issue is fixed, or the Author refutes it with concrete evidence.
- **Never merges over a red check.** Failing required checks halt the run (or trigger a fix under `--resolve`), never a merge.

See [SECURITY.md](./SECURITY.md) for the full threat model and how to report issues.

## Output

```
[mode] --auto (full hands-off)
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 inline comments posted
[3/6] Author iter 1   → triaged 12 comments (7 actionable, 3 noise, 2 already handled)
[3/6] Author iter 1   → 2 fixed, 1 deferred, 1 answered, replies posted, pushed abc1234
[3/6] Author iter 1   → conflict in pricing.ts resolved (merged base, groom-me confirmed) def5678
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: waiting… 2/4 pending
[5/6] CI: unit failed → attributed to this PR → flaky assert corrected, pushed 9ab0cd1
[5/6] CI: e2e failed → attributed to main (fails at 77f2a1c too) → asked, comment posted
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ ef01234
```

The `[mode]` line reflects the flags you passed — `PR only (no flags)`, `--merge`, `--review`, `--resolve`, or `--auto`. Stages that don't run for your mode are simply absent.

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

[MIT](./LICENSE)
