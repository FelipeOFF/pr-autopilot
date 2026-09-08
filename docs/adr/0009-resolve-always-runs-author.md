# `--resolve` always runs the Author, even when the Reviewer approved

§4.7 used to jump from an APPROVED review straight to CI polling. That
skipped the Author: no inventory of other people's comments, no conflict
check, no CI attribution, unless a later poll came back red or
`CONFLICTING`. With `--resolve` or `--auto`, Phase 3 always runs. The
terminal always prints the outcome, including `conflict: none` and
`CI: green`, so a quiet pass is not mistaken for a skip.
