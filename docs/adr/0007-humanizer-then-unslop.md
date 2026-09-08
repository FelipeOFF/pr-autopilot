# Posted prose is humanizer, then unslop, with the invoker's voice

Humanizer already owns every word posted to the PR. Unslop covers many of
the same tells, plus soul. We keep both, in that order, and we do not
replace humanizer. `--unslop` is opt-in; `--auto` does not turn it on. Soul
is the person who invoked this run, identified from their GitHub/GitLab
account, with voice taken from comments they already left on this repo.

## Considered Options

- Replace humanizer with unslop (loses the technical-register exception)
- Silent condensed fallback when unslop is missing (rejected: alert and
  print `npx skills add … --skill=unslop` instead)
- A checked-in voice file (rejected: it ages; the account already posted)
