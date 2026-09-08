# A work item that already has an open PR is reused

`--cascade` implements work items that have no PR yet. If one already
has an open PR, that PR joins the forest (restack its base when it
points at the wrong parent). Opening a second PR abandons the review
already in flight.
