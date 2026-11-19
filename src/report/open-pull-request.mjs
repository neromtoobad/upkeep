// Pushes the Upkeep branch and opens a pull request whose body is the report.
// Uses git and the GitHub CLI the person already has; Upkeep holds no token.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git } from '../workspace/worktree.mjs';

const exec = promisify(execFile);

/** Could not open the pull request; the message says what to run by hand. */
export class PullRequestFailed extends Error {}

/**
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {string} input.branch     the upkeep/… branch
 * @param {string} input.title
 * @param {string} input.bodyFile   path to report.md
 * @param {string} [input.base]     branch the pull request goes to (default: the one checked out)
 * @param {string} [input.remote]
 * @returns {Promise<string>} the pull request URL
 */
export async function openPullRequest({ repoRoot, branch, title, bodyFile, base: givenBase, remote = 'origin' }) {
  // The branch the run started from; the one checked out now only as a fallback.
  const base = givenBase ?? (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot));
  const byHand = `git push -u ${remote} ${branch} && gh pr create --head ${branch} --base ${base} --title "${title}" --body-file "${bodyFile}"`;

  if ((await git(['remote'], repoRoot)).split('\n').filter(Boolean).indexOf(remote) === -1) {
    throw new PullRequestFailed(`this repository has no remote called "${remote}". Add one, then run:\n  ${byHand}`);
  }
  try {
    await git(['push', '-u', remote, branch], repoRoot);
  } catch (error) {
    throw new PullRequestFailed(`could not push ${branch}: ${error.message}\nWhen that is sorted, run:\n  ${byHand}`);
  }
  try {
    const { stdout } = await exec('gh', ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body-file', bodyFile], { cwd: repoRoot });
    return stdout.trim().split('\n').pop();
  } catch (error) {
    const why = error.code === 'ENOENT' ? 'the GitHub CLI (gh) is not installed' : (error.stderr || error.message).trim();
    throw new PullRequestFailed(`the branch is pushed, but the pull request could not be opened: ${why}\nRun:\n  gh pr create --head ${branch} --base ${base} --title "${title}" --body-file "${bodyFile}"`);
  }
}
