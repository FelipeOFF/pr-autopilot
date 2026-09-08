# Under `--cascade`, `--base` is the trunk

`--base` already names the merge target of a single PR. With `--cascade`
that target is the long-lived branch the **root** PR points at (repo
default if omitted). A child's GitHub or GitLab base is the previous
work item's head, not `--base`. A second flag (`--trunk`) would split
one idea; overloading `--base` as "this PR's parent" would hide the
trunk.
