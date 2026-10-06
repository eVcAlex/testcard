# How changes ship

1. **Branch** off `main`: `git switch -c short-name`. One change per branch.
2. **Commit** with one short line. The Fire TV update dialog shows these lines to viewers.
3. **Open a PR** into `main`. CI builds and tests it (TV native, desktop, sync worker, guides).
4. **Beta on the Stick (optional):** Actions > TV native > Run workflow, pick your branch. It publishes a beta build. On the Stick turn on Settings > Beta builds and check for updates.
5. **Merge** the PR once it looks right.
6. **Release:** Actions > TV native > Run workflow on `main` publishes the Fire TV release. The desktop app and the sync worker publish by themselves when `main` changes them.

A beta never replaces the release for other devices. Version codes come from the run number, so a later release is always newer than an earlier beta.
