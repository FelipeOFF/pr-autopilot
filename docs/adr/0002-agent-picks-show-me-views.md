# Agent picks the show-me views from the PR context

A fixed recipe (always a file tree plus one mermaid) is predictable and easy
to implement. It is also wrong for a lot of PRs: a one-line config change
does not need a sequence diagram, and a control-flow change is opaque as a
file tree.

`--show-me` lets the agent choose the smallest views that explain *this*
change. The cost is that two PRs will not look the same. That is acceptable
because the section exists to brief a human reviewer, not to stamp a template.

HTML is still forbidden: GitHub and GitLab will not render it in the
description.
