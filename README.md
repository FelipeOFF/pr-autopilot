# pr-autopilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-7c3aed)](https://docs.claude.com/en/docs/claude-code)
[![Platforms](https://img.shields.io/badge/platforms-GitHub%20%7C%20GitLab-blue)]()

> 🇧🇷 [Leia em Português](./README.pt-BR.md)

A [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) that orchestrates the **full lifecycle of a Pull Request** with multiple coordinated subagents.

**Create → Review → Respond → Re-review → Resolve conflicts & fix CI → Wait for CI → Merge.** Hands-off.

**Opt-in by default.** Every stage is off unless you ask for it. Bare `pr-autopilot` just opens the PR and stops. You switch on each stage with a flag (`--review`, `--resolve`, `--merge`) or turn them all on at once with `--auto`.

---

## What it does

`pr-autopilot` turns a long, manual PR ritual into a single command. It spawns a **Reviewer** subagent that audits your diff and an **Author** subagent that resolves everything in the way of a clean merge — review findings, merge conflicts, and failing CI — looping until the PR is green, then merging. When a conflict or a CI fix would touch a **business rule**, the Author stops and confirms the intended behavior with you (via the [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) skill) before changing anything.

```
┌──────────────────────────────────────────────────────────────┐
│  pr-autopilot (orchestrator)                                 │
│                                                              │
│  ① Preflight + PR creation                                   │
│        │                                                     │
│  ② Reviewer subagent  ──► review-report.md                   │
│        │                                                     │
│  ③ Author subagent    ──► response-summary.md  + commits     │
│        │      fixes comments, resolves conflicts, fixes CI    │
│        │      (business-rule changes → groom-me first)        │
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
- **Author with veto power** — the Author can refute a wrong BLOCKER with evidence instead of blindly applying it.
- **Resolves the whole PR** — with `--resolve`/`--auto`, the Author also resolves **merge conflicts** (merging base into the feature branch, no force-push) and **fixes failing CI** (reads the logs, patches the code, re-runs verification, pushes).
- **Business-rule guardrail** — before a conflict resolution or CI fix changes what the software decides, allows, blocks, or charges, the Author confirms the intended behavior with you via the [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) skill. It never silently ships a decision you didn't make.
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
| **PR + review + resolve** | `/pr-autopilot --resolve` | Creates PR, inline review, Author fixes comments + conflicts + CI, loops, stops before merge (add `--merge` to merge) |
| **Auto (full hands-off)** | `/pr-autopilot --auto` | Everything on, never prompts. Resolves conflicts and fixes CI. Waits for **all** CI checks. Merges only when everything is green. Halts or escalates on any guardrail. |

Notes:

- `--resolve` implies `--review` (you can't resolve comments without a review).
- `--merge` is what enables the merge; without it (or `--auto`) the run always stops before merging.
- `--auto` is shorthand for `--review --resolve --merge` plus "never ask me anything" — but it never relaxes a guardrail: failing tests, a business-rule conflict, an open BLOCKER, or a red check all halt or escalate.

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

# Full review + resolve loop (fixes comments, conflicts, CI), stop before merge
/pr-autopilot --resolve

# Full resolve loop + merge on green CI
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
| `--resolve` | `false` | Run the Author subagent — fixes comments, resolves conflicts, fixes CI. Implies `--review`. |
| `--merge` | `false` | Enable auto-merge on green CI + `MERGEABLE`. Without it the run stops before merge. |
| `--max-iterations` | `2` | Max review→respond (and CI-fix) cycles |
| `--merge-strategy` | `squash` | `squash` \| `merge` \| `rebase` |
| `--base` | auto | Target branch |
| `--draft` | `false` | Open as draft (forces no merge) |
| `--ci-timeout` | `1800` | Seconds before bailing on CI |
| `--ci-poll-interval` | `30` | Seconds between polls |

### Inline review & inline replies

The Reviewer **never** posts a single bulk PR comment. Every finding is posted as an inline comment on the exact file + line, with a severity tag:

- `[BLOCKER]` — must be fixed before merge
- `[SUGGESTION]` — should likely be fixed
- `[NITPICK]` — optional

The Author replies on each inline comment with one of:

- `✅ FIXED in <sha>` — code was changed
- `🛑 REFUTED` — finding is wrong, with code evidence
- `⏸ DEFERRED` — acknowledged, follow-up planned
- `🤷 SKIPPED` — only allowed for NITPICKs

The orchestrator validates that no BLOCKER ever ends up `DEFERRED`/`SKIPPED`.

### Conflicts & CI (with `--resolve` / `--auto`)

Beyond comments, the Author also clears whatever else blocks a clean merge:

- **Merge conflicts** — merges the base into the feature branch, resolves each file (reading the code, git history, and shared memory for prior decisions), commits, and pushes. No history rewrite, no force-push.
- **Failing CI** — pulls the failing job logs, finds the root cause, patches the code, re-runs lint/type/test, commits, and pushes. Loops up to `--max-iterations`.
- **Business-rule guardrail** — if resolving a conflict or fixing CI would change an `if`/validation/threshold/pricing/permission or any domain decision, the Author pauses and confirms the intended behavior with you through the [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) skill before touching it. In a non-interactive run it records the item as escalated and halts rather than guessing.

Full reference in [`SKILL.md`](./SKILL.md).

## How the agents talk to each other

The orchestrator never lets the agents talk directly. They communicate through **typed Markdown artifacts** with YAML front-matter, written under `.pr-autopilot/<PR>/iter-<N>/`:

- `review-report.md` — produced by the Reviewer. Contains `verdict`, `blocker_count`, list of findings.
- `response-summary.md` — produced by the Author. Contains per-finding action (`FIXED`, `REFUTED`, `DEFERRED`), conflict and CI status, commit SHAs, and verification results.

The orchestrator parses the front-matter and decides the next phase. This makes every step **inspectable, replayable, and resumable.**

## Safety

- **Never bypasses hooks.** No `--no-verify`, no `--no-gpg-sign`.
- **Never blind force-pushes.** Conflicts are resolved by merging the base into the feature branch (no history rewrite). The only force allowed is `--force-with-lease` on the *feature* branch when you explicitly chose `--merge-strategy=rebase` — never on a protected branch.
- **Never silently changes a business rule.** A conflict or CI fix that touches a domain decision goes through `groom-me` for your confirmation first.
- **Verification before push.** The Author refuses to push if lint/types/tests regressed.
- **No silent BLOCKER skips.** Either the issue is fixed, or the Author refutes it with concrete evidence.
- **Never merges over a red check.** Failing required checks halt the run (or trigger a fix under `--resolve`), never a merge.

See [SECURITY.md](./SECURITY.md) for the full threat model and how to report issues.

## Output

```
[mode] --auto (full hands-off)
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 inline comments posted
[3/6] Author iter 1   → 2 fixed, 1 deferred, replies posted, pushed abc1234
[3/6] Author iter 1   → conflict in pricing.ts resolved (merged base, groom-me confirmed) def5678
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: waiting… 2/4 pending
[5/6] CI: unit failed → Author fix: flaky assert corrected, pushed 9ab0cd1
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ ef01234
```

The `[mode]` line reflects the flags you passed — `PR only (no flags)`, `--merge`, `--review`, `--resolve`, or `--auto`. Stages that don't run for your mode are simply absent.

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

[MIT](./LICENSE)
