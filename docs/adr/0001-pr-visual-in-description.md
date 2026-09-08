# PR visual lives in the description, as mermaid/markdown

Reviewers need a picture of what the PR does before they read the diff.
`show-me` can open a local HTML file, post a comment, or write into the PR
description. We put it in the description, and we only emit views GitHub and
GitLab actually render (mermaid fences, file trees, call trees, diffs as
markdown).

Local HTML is richer, but the reviewer never sees it. A separate comment
drifts from the body and is easy to miss. `--show-me` is opt-in so a default
PR-only run does not rewrite the description.

## Considered Options

- Local HTML via `show-me` (author-only; reviewers do not see it)
- Top-level PR comment with the visual (easy to miss, drifts from the body)
- PR description, mermaid/markdown only (chosen)
