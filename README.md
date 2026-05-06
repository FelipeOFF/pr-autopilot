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

The skill is a single Markdown file. Clone it into your Claude Code skills directory:

```bash
# User-level (available in every project)
mkdir -p ~/.claude/skills/pr-autopilot
curl -o ~/.claude/skills/pr-autopilot/SKILL.md \
  https://raw.githubusercontent.com/FelipeOFF/pr-autopilot/main/SKILL.md

# OR project-level
mkdir -p .claude/skills/pr-autopilot
cp SKILL.md .claude/skills/pr-autopilot/
```

That's it — Claude Code auto-discovers it on next session.

## Usage

From any branch with commits to ship:

```bash
# Standard: open PR, run the review loop, merge on green CI
/pr-autopilot

# Stop before merge (human sign-off)
/pr-autopilot --no-merge

# Skip review, just create and auto-merge
/pr-autopilot --review=false

# More loops, rebase merge
/pr-autopilot --max-iterations=3 --merge-strategy=rebase

# Draft PR (creation only)
/pr-autopilot --draft
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--review` | `true` | Run the Reviewer/Author loop |
| `--max-iterations` | `2` | Max review→respond cycles |
| `--merge-strategy` | `squash` | `squash` \| `merge` \| `rebase` |
| `--base` | auto | Target branch |
| `--draft` | `false` | Open as draft (no merge) |
| `--no-merge` | `false` | Stop after approval |
| `--ci-timeout` | `1800` | Seconds before bailing on CI |
| `--ci-poll-interval` | `30` | Seconds between polls |

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
[1/6] PR #482 created → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION)
[3/6] Author iter 1   → 2 fixed, 1 deferred, pushed abc1234
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: 4/4 checks green
[6/6] Merged (squash) → main @ def5678
```

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

[MIT](./LICENSE)
