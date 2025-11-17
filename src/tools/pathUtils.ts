import path from 'node:path';
import type {ToolExecutionContext} from '../agent/types.js';

export const resolveRepoPath = (inputPath: string, ctx: ToolExecutionContext): string => {
  const root = path.resolve(ctx.cwd);
  const normalized = inputPath.trim().length ? inputPath.trim() : '.';
  const prefixed = normalized.startsWith('.') ? normalized : `./${normalized}`;
  const target = path.resolve(root, prefixed);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Access outside of repository root is not allowed.');
  }

  return target;
};

export const pathFromRepoRoot = (absolutePath: string, ctx: ToolExecutionContext): string => {
  const root = path.resolve(ctx.cwd);
  return path.relative(root, absolutePath) || '.';
};
