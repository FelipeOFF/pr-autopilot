# Contributing to pr-autopilot

Thanks for the interest. This is a small project — clear, small contributions are easier to review and ship.

## Ground rules

- Be kind. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
- Open an issue **before** opening a large PR. Discussion saves rework.
- Security issues go through [SECURITY.md](./SECURITY.md), not public issues.

## What to contribute

- **Bug reports** — include reproduction steps, the platform (`gh`/`glab`), and the relevant artifact under `.pr-autopilot/<PR>/iter-<N>/` if you can share it.
- **New flags** that have a clear use case.
- **Improvements to the Reviewer or Author prompts** that demonstrably reduce false positives or improve fix quality.
- **Documentation** — both `README.md` (English) and `README.pt-BR.md` (Portuguese) should stay in sync.

## What we will likely decline

- Bypassing safety guardrails (`--no-verify`, force-push, auto conflict resolution).
- Vendor lock-in to a specific CI provider.
- Network calls outside `gh`/`glab`/`git`.
- Heavy frameworks. The skill is a single Markdown file by design.

## Local workflow

1. Fork the repo and create a branch:
   ```
   <type>/<short-slug>
   ```
   Example: `feat/gitlab-draft-flag`.

2. Make your changes. Keep `SKILL.md` operational and unambiguous — it is read by an LLM agent, not just a human.

3. Both READMEs must reflect the change if user-facing behavior changes.

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: Add --foo flag for X
   fix: Correct base detection on detached HEAD
   docs: Document --ci-timeout
   ```

5. Open a PR against `main`. The PR description should contain:
   - **Summary** — why this exists.
   - **Changes** — what changed.
   - **Test plan** — how you verified it.

## Reviewing your own changes

Before requesting review:

- [ ] `SKILL.md` still parses as a valid skill (front-matter intact).
- [ ] Examples in the README still match the actual flag names.
- [ ] No personal data, tokens, or internal URLs in any committed file.
- [ ] License headers untouched.

## Translations

PRs are in English by default. The Portuguese README is a first-class translation — when changing user-facing copy, update both. If you want to add a new language, open an issue first to align on file naming (`README.<locale>.md`).

## License

By contributing, you agree your contribution will be licensed under the [MIT License](./LICENSE).
