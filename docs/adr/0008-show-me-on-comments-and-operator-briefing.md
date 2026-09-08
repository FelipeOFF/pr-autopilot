# Show-me views also go in comments; operator briefing stays in the terminal

ADR 0001 put show-me only in the PR description so a floating comment would
not drift. That still holds for the **PR visual**. A **comment view** is
different: it sits on the finding's line, one view, mermaid/tree/diff, never
HTML. `--show-me` plus `--review` puts one on every finding. Plus `--resolve`
puts one on every reply that still has no reply. The CI triage comment gets
the same treatment. `--show-me-comments` is not posted at all: it briefs the
invoker in the harness conversation, at `path:line`, with the quoted remark.
It does not require `--resolve`. `--auto` implies none of these flags.

## Considered Options

- Description only (ADR 0001 unchanged; rejected for comments because the
  finding is already anchored to a line)
- Local HTML for the operator briefing (rejected: the harness already
  renders markdown)
- Two views per comment (rejected: the Files pane is too narrow)
