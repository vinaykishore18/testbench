# docs/

`manual.html` is the operator field manual: every page of the bench, every
control, every readout, what it measures, how to read it, and what it cannot
tell you.

It is the source of the published copy at claude.ai, so edit it here and
republish rather than editing the published page — otherwise the two drift and
the repo stops being the source of truth.

It is NOT deployed with the site (see `.vercelignore`). The site is the tool;
this is the documentation for whoever operates it.

Three documents, three different jobs:

| file | audience | answers |
|---|---|---|
| `docs/manual.html` | the operator | what does this page measure, and what does the number mean |
| `LEARN.md` | whoever maintains the code | how is this built, and why those decisions |
| `README.md` | whoever deploys it | how do I commit, build and host it |
