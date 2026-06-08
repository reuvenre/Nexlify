import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export type InspectionTarget = 'frontend' | 'backend';

// The backend process always runs with its cwd at `<repo>/backend` (see CLAUDE.md dev commands),
// so the repo root and sibling `frontend/` directory can be derived from process.cwd() —
// this works the same in dev (ts-node) and prod (dist/) without relying on __dirname depth.
const BACKEND_DIR = process.cwd();
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');
const TARGET_DIRS: Record<InspectionTarget, string> = {
  frontend: path.join(REPO_ROOT, 'frontend'),
  backend: BACKEND_DIR,
};

// Fixed allowlist — agents can only run these exact commands, never arbitrary shell strings.
const ALLOWED_CHECKS: Record<InspectionTarget, Record<string, { cmd: string; args: string[] }>> = {
  frontend: {
    lint: { cmd: 'npm', args: ['run', 'lint'] },
    typecheck: { cmd: 'npx', args: ['tsc', '--noEmit'] },
  },
  backend: {
    typecheck: { cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'tsconfig.json'] },
    test: { cmd: 'npm', args: ['test', '--', '--silent'] },
  },
};

const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'coverage']);
const MAX_OUTPUT_CHARS = 8_000;
const MAX_FILE_BYTES = 200_000;
const COMMAND_TIMEOUT_MS = 180_000;

/**
 * Read-only, sandboxed access to the codebase for the architect agents.
 * Agents can inspect files and run lint/typecheck/test — they can never write,
 * execute arbitrary commands, or run git operations. Code-change proposals are
 * produced as plain-text diffs that a human reviews and applies manually.
 */
@Injectable()
export class CodebaseInspectionService {
  private readonly logger = new Logger(CodebaseInspectionService.name);

  private resolveSafe(target: InspectionTarget, relativePath: string): string {
    const base = TARGET_DIRS[target];
    const resolved = path.resolve(base, relativePath || '.');
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error('Path escapes the target directory — access denied');
    }
    return resolved;
  }

  async readFile(target: InspectionTarget, relativePath: string): Promise<string> {
    const fullPath = this.resolveSafe(target, relativePath);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) throw new Error(`Not a file: ${relativePath}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File too large to read (${stat.size} bytes, max ${MAX_FILE_BYTES})`);
    return fs.readFile(fullPath, 'utf-8');
  }

  async listDirectory(target: InspectionTarget, relativePath = '.'): Promise<{ name: string; type: 'file' | 'directory' }[]> {
    const fullPath = this.resolveSafe(target, relativePath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries
      .filter((e) => !IGNORED_DIRS.has(e.name))
      .map((e) => ({ name: e.name, type: e.isDirectory() ? ('directory' as const) : ('file' as const) }));
  }

  /** Search source files for a literal string. Uses ripgrep when available, falls back to grep. */
  async searchCode(target: InspectionTarget, query: string, subPath = 'src'): Promise<string> {
    const base = TARGET_DIRS[target];
    const searchDir = this.resolveSafe(target, subPath);
    const commonOpts = { cwd: base, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 };
    try {
      const { stdout } = await execFileAsync(
        'rg',
        ['--max-count', '5', '--line-number', '--glob', '*.{ts,tsx}', '--', query, searchDir],
        commonOpts,
      );
      return this.truncate(stdout || '(no matches)');
    } catch (rgErr: any) {
      if (rgErr.stdout) return this.truncate(rgErr.stdout); // rg exits 1 on no matches
      try {
        const { stdout } = await execFileAsync(
          'grep',
          ['-rn', '--include=*.ts', '--include=*.tsx', '-m', '5', '--', query, searchDir],
          commonOpts,
        );
        return this.truncate(stdout || '(no matches)');
      } catch (grepErr: any) {
        return grepErr.stdout ? this.truncate(grepErr.stdout) : '(no matches)';
      }
    }
  }

  /** Runs `npm audit --json` (read-only) and returns a severity summary for the security agent. */
  async runDependencyAudit(target: InspectionTarget): Promise<{ summary: Record<string, number>; raw: string }> {
    const base = TARGET_DIRS[target];
    try {
      const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
        cwd: base, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024,
      });
      return this.parseAuditOutput(stdout);
    } catch (err: any) {
      // npm audit exits non-zero when vulnerabilities are found — output is still on stdout
      if (err.stdout) return this.parseAuditOutput(err.stdout);
      return { summary: {}, raw: this.truncate(err.stderr || err.message) };
    }
  }

  private parseAuditOutput(stdout: string): { summary: Record<string, number>; raw: string } {
    try {
      const parsed = JSON.parse(stdout);
      const summary = parsed?.metadata?.vulnerabilities || {};
      return { summary, raw: this.truncate(stdout) };
    } catch {
      return { summary: {}, raw: this.truncate(stdout) };
    }
  }

  async runCheck(target: InspectionTarget, check: string): Promise<{ passed: boolean; output: string }> {
    const allowed = ALLOWED_CHECKS[target]?.[check];
    if (!allowed) {
      throw new Error(`Unknown check "${check}" for target "${target}". Allowed: ${Object.keys(ALLOWED_CHECKS[target] || {}).join(', ')}`);
    }
    const base = TARGET_DIRS[target];
    try {
      const { stdout, stderr } = await execFileAsync(allowed.cmd, allowed.args, {
        cwd: base, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024,
      });
      return { passed: true, output: this.truncate(`${stdout}\n${stderr}`.trim()) };
    } catch (err: any) {
      return { passed: false, output: this.truncate(`${err.stdout || ''}\n${err.stderr || err.message}`.trim()) };
    }
  }

  private truncate(text: string): string {
    return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n... (truncated)` : text;
  }
}
