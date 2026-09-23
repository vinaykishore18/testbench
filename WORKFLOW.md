# How changes reach the live site

Everything so far has gone straight onto `main`, which is also what Cloudflare
Pages deploys. That means every change has been published the moment it was
committed, with no step in between where anything could be looked at. A bad
commit is live before you know it is bad, and the only way back is another
commit forward.

This is the fix, and it costs about thirty seconds per change.

## The rule

`main` is the live site. Nothing is committed to it directly, ever.
Work happens on a branch; the branch is merged once it has been seen working.

## In GitHub Desktop

**1. Before touching anything, make a branch**

`Current branch` → `New branch`. Name it for the change, not the date:
`fix-mouse-polling`, `light-theme`, `bench-run`. Base it on `main`.

**2. Do the work and commit to that branch**

Same as always — the commit box now says *Commit to fix-mouse-polling*
instead of *Commit to main*. If it still says `main`, stop: you are about to
publish straight to the shop.

**3. Publish the branch**

`Publish branch`. This pushes the branch to GitHub and **does not touch the
live site.** Cloudflare Pages builds it as a *preview deployment* with its own
URL — the branch name in front of your domain. You get a fully working copy of
the change to click through before anyone else sees it.

**4. Look at the preview, then merge**

Cloudflare shows the preview URL under the deployment. Open it, use the thing
you changed, hard-refresh with `Ctrl+Shift+R`. Only when it is right:
`Branch` → `Create pull request`, then **Merge** on GitHub. That is the moment
it goes live.

**5. Delete the branch**

GitHub offers this right after merging. Take it. Branches are cheap and stale
ones are confusing.

## Turning previews on in Cloudflare Pages

Pages → your project → **Settings → Builds & deployments → Preview
deployments** → set to **All non-production branches**. It is usually on by
default. Production branch stays `main`.

## If something bad does reach main

`History` in GitHub Desktop → right-click the bad commit → **Revert changes in
commit**. That creates a new commit undoing it, which you push to `main`. Do
not force-push, and do not try to edit history on a branch that is deployed.

## Before you merge anything

Run the suites. They exist so that a change that breaks something does not
reach the bench in the middle of a work day:

    python3 -m http.server 8099 &
    npm install playwright
    node test/security.mjs
    node test/smoke.mjs
    node test/themes.mjs

`security.mjs` needs no browser and takes a second. Run at least that one.
