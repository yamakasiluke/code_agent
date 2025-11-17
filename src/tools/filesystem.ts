import fs from 'node:fs/promises';
import path from 'node:path';
import type {Tool} from '../agent/types.js';
import {pathFromRepoRoot, resolveRepoPath} from './pathUtils.js';

const formatDirEntry = async (target: string, entry: string) => {
  try {
    const stat = await fs.stat(path.join(target, entry));
    return stat.isDirectory() ? `${entry}/` : entry;
  } catch (error) {
    return `${entry} (error: ${(error as Error).message})`;
  }
};

export const createListFilesTool = (): Tool => ({
  name: 'list_files',
  description: 'List files and directories relative to the repository root.',
  inputGuide: 'relative directory path, defaults to .',
  async execute(input, ctx) {
    const relative = input.trim() || '.';
    const target = resolveRepoPath(relative, ctx);
    const entries = await fs.readdir(target);
    const formatted = await Promise.all(entries.map(entry => formatDirEntry(target, entry)));
    return formatted.join('\n');
  }
});

export const createReadFileTool = (): Tool => ({
  name: 'read_file',
  description: 'Read the contents of a UTF-8 text file within the repo.',
  inputGuide: 'relative file path, e.g. src/index.tsx',
  async execute(input, ctx) {
    const relative = input.trim();
    if (!relative) {
      throw new Error('Please provide a file path relative to the repository root.');
    }

    const target = resolveRepoPath(relative, ctx);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      throw new Error('Cannot read a directory. Provide a file path.');
    }

    if (stat.size > 200_000) {
      return 'File too large to display (200KB limit).';
    }

    const contents = await fs.readFile(target, 'utf8');
    if (contents.length > 4000) {
      return `${contents.slice(0, 4000)}\n...truncated...`;
    }

    return contents;
  }
});

interface WriteFilePayload {
  path: string;
  contents: string;
}

const parseWritePayload = (input: string): WriteFilePayload => {
  try {
    const payload = JSON.parse(input) as Partial<WriteFilePayload>;
    if (!payload || typeof payload.path !== 'string') {
      throw new Error('Missing "path" string field.');
    }
    if (typeof payload.contents !== 'string') {
      throw new Error('Missing "contents" string field.');
    }
    return {path: payload.path, contents: payload.contents};
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON. Provide {"path": "...", "contents": "..."}.');
    }
    throw error;
  }
};

export const createWriteFileTool = (): Tool => ({
  name: 'write_file',
  description: 'Write (create or overwrite) a UTF-8 text file relative to the repository root.',
  inputGuide: 'JSON: {"path": "src/example.ts", "contents": "..."}',
  async execute(input, ctx) {
    const payload = parseWritePayload(input);
    const target = resolveRepoPath(payload.path, ctx);
    const directory = path.dirname(target);

    await fs.mkdir(directory, {recursive: true});
    await fs.writeFile(target, payload.contents, 'utf8');

    return `Wrote ${payload.contents.length} characters to ${pathFromRepoRoot(target, ctx)}`;
  }
});
