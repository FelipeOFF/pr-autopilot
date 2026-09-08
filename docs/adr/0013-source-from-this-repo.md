# Tracker source is this repo, or the IDs in the prompt

A harness may have a Jira MCP for other work. Treating "MCP exists" as
"this repo uses Jira" would prompt GitHub vs Jira on every `--cascade`
here. GitHub if origin is GitHub, GitLab if GitLab, beads if `.beads/`
exists, Jira only with a repo project or `PROJ-123` in the prompt.
`#9` / `PROJ-12` / a `bd` id pick the source without asking. Cairn
tickets are beads, not a fourth tracker. Two sources in *this* repo, or
zero, and the prompt does not disambiguate: ask once. No config file in
this decision; that is a follow-up.
