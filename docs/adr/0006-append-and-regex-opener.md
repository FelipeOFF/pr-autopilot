# Append the PR visual section; detect it by a template first sentence

The PR description is often not the Summary/Changes/Test plan template. The
human may pass `--body`, edit the GitHub/GitLab form, or reuse an existing
PR. Splicing after `## Summary` would guess at a structure we do not own.

`--show-me` always appends the section at the end, unless it is already
there. Presence is a regex on the section opener — the first sentence, which
comes from a fixed template, not from the generated briefing. Replacement
is the heading block (`## What this PR does` through the next `##` or EOF).

The opener is exempt from `humanizer`. If that sentence is rewritten, the
next run cannot find the section and will append a duplicate.
