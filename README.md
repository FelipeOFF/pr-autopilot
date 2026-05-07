# pr-autopilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-7c3aed)](https://docs.claude.com/en/docs/claude-code)
[![Platforms](https://img.shields.io/badge/platforms-GitHub%20%7C%20GitLab-blue)]()

> 🇧🇷 [Leia em Português](./README.pt-BR.md)

A [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) that orchestrates the **full lifecycle of a Pull Request** with multiple coordinated subagents.

**Create → Review → Respond → Re-review → Wait for CI → Merge.** Hands-off.

---

## What it does

`pr-autopilot` turns a long, manual PR ritual into a single command. It spawns a **Reviewer** subagent that audits your diff, an **Author** subagent that addresses the findings, loops them until the review is clean, then waits for CI and merges.

```
┌──────────────────────────────────────────────────────────────┐
│  pr-autopilot (orchestrator)                                 │
│                                                              │
│  ① Preflight + PR creation                                   │
│        │                                                     │
│  ② Reviewer subagent  ──► review-report.md                   │
│        │                                                     │
│  ③ Author subagent    ──► response-summary.md  + commits     │
│        │                                                     │
│  ④ Loop until APPROVED or max-iterations hit                 │
│        │                                                     │
│  ⑤ Poll CI checks                                            │
│        │                                                     │
│  ⑥ Auto-merge (squash / merge / rebase)                      │
└──────────────────────────────────────────────────────────────┘
```

## Features

- **Auto title + body** from commits and diff, following Conventional Commits + Jira.
- **Multi-agent review loop** with structured findings: `BLOCKER`, `SUGGESTION`, `NITPICK`, `APPROVED`.
- **Author with veto power** — the Author can refute a wrong BLOCKER with evidence instead of blindly applying it.
- **Verification gates** — lint, type-check and tests must stay green before pushing review fixes.
- **CI polling** with adaptive backoff, configurable timeout, and real failure logs surfaced to the user.
- **Resumable state** — every artifact is persisted under `.pr-autopilot/<PR>/`. Re-running picks up at the right phase.
- **GitHub & GitLab** out of the box (`gh` / `glab`).
- **Safe by default** — never `--no-verify`, never `--force`, never auto-resolve conflicts.

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
(`--auto`, `--review`, `--resolve`, `--no-merge`, `--draft`, …) appear inline
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

You pick one of four modes:

| Mode | How to invoke | What happens |
|------|---------------|--------------|
| **PR only** | `/pr-autopilot --review=false` | Creates PR, waits for CI, merges |
| **PR + review** | `/pr-autopilot --review=true --resolve=false` | Creates PR, posts **inline** review comments, stops |
| **PR + review + resolve** *(default)* | `/pr-autopilot` | Creates PR, inline review, Author replies inline + commits fixes, loops, then merge on green CI |
| **Auto (full hands-off)** | `/pr-autopilot --auto` | Same as default, but explicit: never prompts. Waits for **all** CI checks. Merges only when everything is green. Halts on any failure. |

`--auto` is shorthand for "do the whole thing without asking me anything, but never merge if tests fail." It does not relax any guardrail.

## Usage

From any branch with commits to ship:

```bash
# Fully autonomous: review + resolve + wait CI + merge
/pr-autopilot --auto

# Default: review + resolve + merge
/pr-autopilot

# Open PR, post inline review, stop (human will resolve)
/pr-autopilot --review=true --resolve=false

# Skip review, just create and auto-merge
/pr-autopilot --review=false

# Stop before merge (human sign-off)
/pr-autopilot --no-merge

# Auto mode with tighter loop and rebase merge
/pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
/pr-autopilot --draft
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | `false` | Full hands-off: review + resolve + wait CI + merge. Never prompts. |
| `--review` | `true` | Run the Reviewer subagent (inline comments) |
| `--resolve` | `true` | Run the Author subagent (inline replies + fixes) |
| `--max-iterations` | `2` | Max review→respond cycles |
| `--merge-strategy` | `squash` | `squash` \| `merge` \| `rebase` |
| `--base` | auto | Target branch |
| `--draft` | `false` | Open as draft (no merge) |
| `--no-merge` | `false` | Stop after approval |
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

Full reference in [`SKILL.md`](./SKILL.md).

## How the agents talk to each other

The orchestrator never lets the agents talk directly. They communicate through **typed Markdown artifacts** with YAML front-matter, written under `.pr-autopilot/<PR>/iter-<N>/`:

- `review-report.md` — produced by the Reviewer. Contains `verdict`, `blocker_count`, list of findings.
- `response-summary.md` — produced by the Author. Contains per-finding action (`FIXED`, `REFUTED`, `DEFERRED`), commit SHAs, and verification results.

The orchestrator parses the front-matter and decides the next phase. This makes every step **inspectable, replayable, and resumable.**

## Safety

- **Never bypasses hooks.** No `--no-verify`, no `--no-gpg-sign`.
- **Never force-pushes.** Push conflicts halt the loop and surface the diff to you.
- **Never auto-resolves merge conflicts.** Stops and asks.
- **Verification before push.** The Author refuses to push if lint/types/tests regressed.
- **No silent BLOCKER skips.** Either the issue is fixed, or the Author refutes it with concrete evidence.

See [SECURITY.md](./SECURITY.md) for the full threat model and how to report issues.

## Output

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

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

[MIT](./LICENSE)
