# `--cascade` is opt-in; `--auto` does not turn it on

`--auto` already means review + resolve + merge. Making it also build or
walk a stacked forest would ship extra PRs the invoker did not name, and
`--auto` cannot ask which work items. `--cascade` (or a phrase that means
the same) is the only way on. cascade-flow `--full` is a panorama; it
does not turn this flag on either.

0007–0009 record the unslop / comment-view / Author-always decisions and
live on that PR. Numbering here starts at 0010 so the two branches do not
collide.
