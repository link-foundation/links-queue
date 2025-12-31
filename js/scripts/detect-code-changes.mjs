#!/usr/bin/env node

/**
 * Detect code changes for CI/CD pipeline
 *
 * This script detects what types of files have changed between two commits
 * and outputs the results for use in GitHub Actions workflow conditions.
 *
 * Key behavior:
 * - For PRs: compares PR head against base branch
 * - For pushes: compares HEAD against HEAD^
 * - Excludes certain folders and file types from "code changes" detection
 *
 * Excluded from code changes (don't require changelog fragments):
 * - Markdown files (*.md) in any folder
 * - .changeset/ folder (changelog fragments)
 * - docs/ folder (documentation)
 * - experiments/ folder (experimental scripts)
 * - examples/ folder (example scripts)
 *
 * Usage:
 *   node scripts/detect-code-changes.mjs
 *
 * Environment variables (set by GitHub Actions):
 *   - GITHUB_EVENT_NAME: 'pull_request' or 'push'
 *   - GITHUB_BASE_SHA: Base commit SHA for PR
 *   - GITHUB_HEAD_SHA: Head commit SHA for PR
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - mjs-changed: 'true' if any .mjs files changed
 *   - js-changed: 'true' if any .js files changed
 *   - package-changed: 'true' if any package.json files changed
 *   - docs-changed: 'true' if any .md files changed
 *   - workflow-changed: 'true' if any .github/workflows/ files changed
 *   - any-code-changed: 'true' if any code files changed (excludes docs, changelog.d, experiments, examples)
 */

import { execSync } from 'child_process';
import { appendFileSync } from 'fs';

/**
 * Execute a shell command and return trimmed output
 * @param {string} command - The command to execute
 * @returns {string} - The trimmed command output
 */
function exec(command) {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    return '';
  }
}

/**
 * Write output to GitHub Actions output file
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

/**
 * Get the list of changed files between two commits
 * @returns {string[]} Array of changed file paths
 */
function getChangedFiles() {
  const eventName = process.env.GITHUB_EVENT_NAME || 'local';

  if (eventName === 'pull_request') {
    const baseSha = process.env.GITHUB_BASE_SHA;
    const headSha = process.env.GITHUB_HEAD_SHA;

    if (baseSha && headSha) {
      console.log(`Comparing PR: ${baseSha}...${headSha}`);
      try {
        // Ensure we have the base commit
        try {
          execSync(`git cat-file -e ${baseSha}`, { stdio: 'ignore' });
        } catch {
          console.log('Base commit not available locally, attempting fetch...');
          execSync(`git fetch origin ${baseSha}`, { stdio: 'inherit' });
        }
        const output = exec(`git diff --name-only ${baseSha} ${headSha}`);
        return output ? output.split('\n').filter(Boolean) : [];
      } catch (error) {
        console.error(`Git diff failed: ${error.message}`);
      }
    }
  }

  // For push events or fallback
  console.log('Comparing HEAD^ to HEAD');
  try {
    const output = exec('git diff --name-only HEAD^ HEAD');
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    // If HEAD^ doesn't exist (first commit), list all files in HEAD
    console.log('HEAD^ not available, listing all files in HEAD');
    const output = exec('git ls-tree --name-only -r HEAD');
    return output ? output.split('\n').filter(Boolean) : [];
  }
}

/**
 * Check if a file should be excluded from code changes detection
 * @param {string} filePath - The file path to check
 * @returns {boolean} True if the file should be excluded
 */
function isExcludedFromCodeChanges(filePath) {
  // Only consider files in the js/ folder
  if (!filePath.startsWith('js/')) {
    return true;
  }

  // Get relative path within js folder
  const relativePath = filePath.replace(/^js\//, '');

  // Exclude markdown files in any folder
  if (relativePath.endsWith('.md')) {
    return true;
  }

  // Exclude specific folders from code changes
  const excludedFolders = ['.changeset/', 'docs/', 'experiments/', 'examples/'];

  for (const folder of excludedFolders) {
    if (relativePath.startsWith(folder)) {
      return true;
    }
  }

  return false;
}

/**
 * Main function to detect changes
 */
function detectChanges() {
  console.log('Detecting file changes for CI/CD (JS)...\n');

  const changedFiles = getChangedFiles();

  // Filter to only js/ folder files
  const jsChangedFiles = changedFiles.filter((file) => file.startsWith('js/'));

  console.log('Changed files in js/:');
  if (jsChangedFiles.length === 0) {
    console.log('  (none)');
  } else {
    jsChangedFiles.forEach((file) => console.log(`  ${file}`));
  }
  console.log('');

  // Detect .mjs file changes (scripts)
  const mjsChanged = jsChangedFiles.some((file) => file.endsWith('.mjs'));
  setOutput('mjs-changed', mjsChanged ? 'true' : 'false');

  // Detect .js file changes (source)
  const jsChanged = jsChangedFiles.some((file) => file.endsWith('.js'));
  setOutput('js-changed', jsChanged ? 'true' : 'false');

  // Detect package.json changes
  const packageChanged = jsChangedFiles.some((file) =>
    file.endsWith('package.json')
  );
  setOutput('package-changed', packageChanged ? 'true' : 'false');

  // Detect documentation changes (any .md file)
  const docsChanged = jsChangedFiles.some((file) => file.endsWith('.md'));
  setOutput('docs-changed', docsChanged ? 'true' : 'false');

  // Detect workflow changes
  const workflowChanged = changedFiles.some(
    (file) => file.startsWith('.github/workflows/') && file.includes('js')
  );
  setOutput('workflow-changed', workflowChanged ? 'true' : 'false');

  // Detect code changes (excluding docs, .changeset, experiments, examples folders, and markdown files)
  const codeChangedFiles = jsChangedFiles.filter(
    (file) => !isExcludedFromCodeChanges(file)
  );

  console.log('\nFiles considered as code changes:');
  if (codeChangedFiles.length === 0) {
    console.log('  (none)');
  } else {
    codeChangedFiles.forEach((file) => console.log(`  ${file}`));
  }
  console.log('');

  // Check if any code files changed (.js, .mjs, .yml, .yaml, or workflow files)
  const codePattern = /\.(mjs|js|yml|yaml)$|\.github\/workflows\//;
  const codeChanged = codeChangedFiles.some((file) => codePattern.test(file));
  setOutput('any-code-changed', codeChanged ? 'true' : 'false');

  console.log('\nChange detection completed.');
}

// Run the detection
detectChanges();
