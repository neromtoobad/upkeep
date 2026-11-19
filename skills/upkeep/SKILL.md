---
name: upkeep
description: Update outdated npm packages and prove the app still works. Use when the user asks to update, upgrade or bump dependencies, to clear npm audit findings by upgrading, or to deal with a pile of Dependabot or Renovate updates. Runs Upkeep, which upgrades on a separate branch and keeps only what Kane CLI verifies in a real browser.
---

# Upkeep

Upkeep upgrades a project's outdated npm packages on its own branch. After each set of upgrades
it installs, builds and boots the app, and Kane CLI walks the project's plain-English flows in a
real browser. What passes is committed. What fails is narrowed down to the package that broke
the app, and a coding agent is asked to fix the app, with Kane checking the fix.

You do not judge whether an upgrade is safe. Kane does. Your part is to start the run, to fix
the app when Upkeep hands you a failure, and to report what happened.

## Before you start

1. `kane-cli whoami` must say Authenticated. If not, start sign-in with `kane-cli login --oauth`
   and wait for the user. Never ask for an access key or password.
2. The project needs at least one Kane flow: a `*_test.md` file (usually under `flows/`) with
   `url: http://localhost:<port>` in its header. If there are none, stop and ask the user which
   two or three journeys matter most (sign in, add to cart, check out), write them in the user's
   words as `flows/<name>_test.md`, and show them before running anything. The flows define what
   "works" means, so the user decides them, not you.
3. Nothing else may be listening on that port. Stop any dev server you started.

## Run it

```bash
npx github:neromtoobad/upkeep plan
```

Show the user the plan: what is behind, what may break, what moves together and why.

```bash
npx github:neromtoobad/upkeep run --agent claude
```

- `--agent claude` starts a separate headless Claude Code for each fix. `--agent codex` does the
  same with Codex CLI. For any other headless agent pass its command, for example
  `--agent "my-agent --task-file {prompt_file}"`.
- `--agent handoff` makes **you** the fixer, in this session. Use it when you are an agent in an
  editor (Cursor, Windsurf, Kiro, Copilot) or when the user wants to watch the fixes happen here.
  See "Handoff" below.
- A run takes minutes to an hour and spends Kane credits (about 8 per passing check, more for a
  failing one). Tell the user that before starting, and run it in the background.
- Leave out `--agent` to only find and hold back the upgrades that break the app.
- Add `--pr` to push the branch and open a pull request with the report.
- `--only a,b` and `--exclude a,b` narrow the set. `--target wanted` stays inside the version
  ranges already in package.json.

Exit codes: `0` everything was upgraded, `3` some upgrades were held back (the branch is still
good), `4` the check could not run (not signed in, no credits, port taken), `1` the app did not
pass its flows before any upgrade.

## Handoff: you are the fixer

```bash
npx github:neromtoobad/upkeep run --agent handoff     # start it in the background; it pauses when it needs you
npx github:neromtoobad/upkeep wait                    # blocks until there is a task for you, or the run is over
```

`upkeep wait` exits `10` and prints a task when Kane has confirmed that an upgrade broke the app.
The task ends with the folder to edit: a worktree, **not** the user's checkout. Edit the app
there, following the rules in the task, then:

```bash
npx github:neromtoobad/upkeep continue --message "what you changed, in a sentence"
npx github:neromtoobad/upkeep wait
```

Upkeep checks your edit with its guard and has Kane walk the app again. `wait` then prints either
the next task (Kane still fails, or another upgrade broke something), or the final result with
exit `0` or `3`. Exit `11` means it is still working: run `wait` again. Keep going until `wait`
prints the result. Do not edit the user's checkout, and do not try to judge the fix yourself:
Kane's next walk is the judgement.

## When Upkeep hands you a failure

If you are the agent Upkeep started, your task arrives as text. It names the upgrade, what Kane
saw in the browser, where the app uses the package, and the rules. Follow the rules in it:

- Fix the app code. Do not change versions, add overrides, or edit the flows or their recordings.
  Upkeep undoes those and tells you.
- You cannot run the browser. Stop when you have made the change; Upkeep has Kane walk the app
  again and sends you the new result if it still fails.
- Read the changelog and types of the installed package before guessing at its new API.

## Afterwards

Read the report Upkeep names at the end (`.upkeep/runs/<time>/report.md`) and tell the user:

- how many packages were upgraded as they are, how many needed a fix, how many were held back
- for each fix: what Kane caught and what was changed
- for each held-back upgrade: what breaks, in Kane's words
- the branch name, and that their checkout was not touched

Do not merge the branch or open a pull request unless the user asks.
