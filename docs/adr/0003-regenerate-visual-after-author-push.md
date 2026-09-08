# Regenerate the PR visual section after an Author push that changed the diff

`--show-me` is an explicit request to keep the description honest about what
the PR does. If the Author then changes the diff in the same run, a stale
section lies to the reviewer.

The section is regenerated only when `--show-me` is on *and* the Author's
push actually changed the diff. A no-op round leaves the section alone. The
invisible marker around the section is what makes the update a replace, not
a second copy.

`--auto` still does not imply `--show-me`. Regeneration is not a new stage;
it is the same flag applying again.
