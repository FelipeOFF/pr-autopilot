# Existing-chain mode merges the path to the current PR

`--cascade --merge` with no work-item IDs, on a PR whose base is not
the trunk, walks trunk → … → current. Siblings stay. Merging the whole
connected component would ship a PR the invoker was not on. Merging
only the current PR into its parent branch, while that parent is still
open, is the out-of-order merge `--cascade` exists to stop.

When the parent has landed and GitHub did not retarget, the current PR
is a dangling child: point it at the trunk, merge the trunk into the
feature, re-verify, then merge if `--merge` or `--auto` is on.
