# Low-usage PR review proposal

The accompanying snapshot workflow runs only when a maintainer manually
dispatches it. It has read permissions and does not approve, mark ready,
merge, label, comment, or change repository settings. The separate
[`merge-when-ready.yml`](../.github/workflows/merge-when-ready.yml) workflow
handles owner opt-in to native auto-merge. Neither workflow deploys Beam.

## Current repository facts (3 November 2026)

- `shawkkkkk/beam` is public and native auto-merge is enabled. The owner set a
  classic `main` protection rule with required hosted checks, branch freshness,
  resolved conversations, and no administrator bypass. See
  [AUTO_MERGE.md](AUTO_MERGE.md) for the exact checks and opt-in procedure.
- The connected GitHub App still cannot read the classic branch-protection
  endpoint; the rule was verified in the owner's GitHub settings. The read-only
  rulesets endpoint is empty. No merge queue is configured.
- Existing workflows are contract, website, native SDK/service, and AMM v4
  local-validator tests. They request read permissions. Website browser tests
  are separate from hosted website CI; a green check is not full product
  validation.
- The repository owner is `shawkkkkk`. Neither workflow creates a bot account,
  personal token, GitHub App installation, or secret.

## What the read-only workflow supplies

`.github/workflows/pr-review-snapshot.yml` reads one PR on manual request. It
prints its head SHA, draft/mergeable API values, and the first page of check
runs and reviews in the run summary. It uses the built-in ephemeral
`GITHUB_TOKEN` with `contents: read`, `pull-requests: read`, and `checks: read`.
It does not check out or execute PR code and does not treat a label, green job,
or review count as approval. API results are a point-in-time snapshot; a new
head invalidates any previous assessment. The first-page cap also means the
summary cannot prove every check or review was inspected.

## Separate merge automation

The owner-only `merge-when-ready` label triggers a separate privileged workflow
that rechecks the PR head and delegates timing to GitHub's protected-branch
auto-merge. Its workflow file comes from the trusted base branch; it never
checks out PR code. The label must be applied after reviewing the exact head
and combined tree. Contract funds, fees, authorization, workflows, migrations,
and dependency trust need deliberate human review and applicable runtime tests.
`gh pr merge --match-head-commit` guards the enablement action; branch
protection supplies the continuing merge gates. See [AUTO_MERGE.md](AUTO_MERGE.md).

No workflow should self-approve, bypass protections, use admin override, silently
merge a draft, or infer production readiness from source/host/mock checks.

References: [GitHub native auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request),
[GitHub `pull_request_target` security](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target),
and [`gh pr merge` options](https://cli.github.com/manual/gh_pr_merge).
