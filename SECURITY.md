# Security Policy

`pr-autopilot` is a Claude Code skill that drives `git`, `gh`/`glab`, and your CI on your behalf. Security is non-negotiable.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, open a [GitHub Security Advisory](https://github.com/FelipeOFF/pr-autopilot/security/advisories/new) with:

- A clear description of the issue.
- Steps to reproduce or proof-of-concept.
- Affected version / commit SHA.
- Impact assessment (what an attacker could achieve).

We aim to triage within 5 business days.

## Threat model

`pr-autopilot` runs **inside your trusted environment** (your laptop or CI runner) using credentials you already hold (`gh`, `glab`, git). It does **not** add a new authentication surface, but it amplifies the actions a single command can take.

### In scope

- The skill should never bypass repository safeguards (branch protection, required reviews, signed commits, pre-commit hooks).
- The skill should never exfiltrate secrets through commit messages, PR bodies, or third-party services.
- The Reviewer/Author subagents should not introduce code that disables existing security controls.

### Out of scope

- Vulnerabilities in `gh`, `glab`, `git`, Claude Code itself, or your CI provider.
- Misuse of the skill in a repository where the operator already has destructive permissions (the skill is no more dangerous than the credentials feeding it).

## Hard guardrails (enforced by SKILL.md)

These are baked into the orchestration logic. A change that weakens them is a security regression and will be reverted:

1. **No `--no-verify`.** Pre-commit and pre-push hooks always run.
2. **No `--force` / `--force-push`.** Push rejections halt the pipeline.
3. **No auto-resolve of merge conflicts.** Stops and surfaces the conflict.
4. **No silent BLOCKER skip.** A `BLOCKER` finding must be either fixed or formally refuted with code-level evidence.
5. **Verification gate before push.** The Author halts if lint, type-check, or tests regress.
6. **Never amends pushed commits.** New commits only.
7. **No automatic retries on CI failure.** Failures surface to the user.
8. **No editing of CI/CD config or secrets** during the review-response loop unless that is the actual scope of the PR.

## Recommended operator practices

- Run the skill from a non-privileged shell that only has access to the repos it needs.
- Keep `gh auth status` to **least-privilege scopes** — `repo` is enough; avoid `admin:org` unless necessary.
- Enable **branch protection** on default branches with required CI and required reviews. The skill respects these and will halt if it cannot merge cleanly.
- Treat the skill as automation — review the PR diff before invoking, especially on shared codebases.
- Use **short-lived tokens** in CI environments.

## Data handling

`pr-autopilot` does not phone home. All data — diffs, review reports, response summaries — stays in your local filesystem (`.pr-autopilot/`) and on your Git host. Only the LLM provider you configured for Claude Code receives content as part of normal agent operation.

The local artifact directory `.pr-autopilot/` may contain diff snippets and review notes. Add it to `.gitignore` if you do not want it committed (the project's own `.gitignore` already excludes it).

## Disclosure timeline

For accepted reports we follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure):

1. Acknowledge within 5 business days.
2. Patch on a private branch.
3. Public release + advisory after fix lands.
4. Credit to the reporter (unless they prefer anonymity).
