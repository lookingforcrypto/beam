# Owner opt-in auto-merge

GitHub's native auto-merge is enabled for Beam, and `main` has a classic
protection rule. The rule requires a pull request, the five hosted checks
(`source-and-host-tests`, `build`, `golden-abi`, `amm-v4-validator`, and
`legacy-trade-runtime`), an up-to-date branch, and resolved conversations.
Administrators cannot bypass these requirements. No approval count is required:
the repository currently has no collaborators who could approve the owner's
pull requests.

After reviewing a ready, non-draft PR targeting `main`, the repository owner
may add the `merge-when-ready` label. The
[`merge-when-ready.yml`](../.github/workflows/merge-when-ready.yml) workflow
checks the current PR state and head, then asks GitHub to squash-merge it when
all protected-branch requirements pass. It uses the base branch's workflow
definition, does not check out or run PR code, and does not use a personal
token or administrator bypass. Only a label event from `@shawkkkkk` can enable
auto-merge. Removing the label or pushing a new head cancels a pending
auto-merge request for a labeled PR. Existing PRs are unaffected until the
owner adds the label after this workflow lands on `main`.

The label is an owner decision to queue a merge, not evidence that a PR is safe
or complete. Before applying it, review the exact head and combined target
tree, verify that the relevant tests actually ran, resolve review findings,
and check the current task ownership. Keep migration, custody, fee-routing,
workflow-permission, and other security-sensitive changes under deliberate
manual review. A green host or mock test does not authorize deployment or
activate a blocked feature. If a PR changes after the label event, review the
new head, then remove and re-add the label to opt in again; GitHub's branch rule
will still require fresh checks and an up-to-date branch. GitHub also disables
native auto-merge when a contributor without write access pushes a new head.

This setup can be audited in GitHub's repository settings under **Branches**
and **Pull Requests**. If a required workflow is renamed, update the branch
rule and this document together; otherwise GitHub will wait for a check that
never reports. The read-only
[`pr-review-snapshot.yml`](../.github/workflows/pr-review-snapshot.yml) remains
available for a manual evidence snapshot and does not approve or merge PRs.
