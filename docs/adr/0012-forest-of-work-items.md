# The graph is a forest of work items, not a line and not the spec

`/to-tickets` already writes `Blocked by`. Independent ready-for-agent
tickets are roots against the trunk; a child stacks only when that graph
says so. Stacking by issue number invents a dependency the review will
believe. The spec or epic is the container: it does not get a PR. One PR
for the whole spec is how #14 shipped; `--cascade` is the other shape.
