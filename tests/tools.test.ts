import fs from 'node:fs/promises';
import path from 'node:path';
import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import type {ToolExecutionContext} from '../src/agent/types.js';
import {createListFilesTool, createReadFileTool, createWriteFileTool} from '../src/tools/filesystem.js';
import {
  createAutomationsTool,
  createBioTool,
  createFileSearchTool,
  createImageGenTool,
  createNodeTool,
  createNodeUserVisibleTool,
  createWebTool
} from '../src/tools/system.js';
import {pathFromRepoRoot, resolveRepoPath} from '../src/tools/pathUtils.js';

const createCtx = (): ToolExecutionContext => ({
  cwd: process.cwd(),
  signal: new AbortController().signal
});

const tempDir = path.join(process.cwd(), 'tmp-test-output');

beforeAll(async () => {
  await fs.rm(tempDir, {recursive: true, force: true});
  await fs.mkdir(tempDir, {recursive: true});
});

afterAll(async () => {
  await fs.rm(tempDir, {recursive: true, force: true});
});

describe('filesystem tools', () => {
  it('lists files in the repository root', async () => {
    const tool = createListFilesTool();
    const output = await tool.execute('.', createCtx());
    expect(output).toContain('src');
  });

  it('reads an existing file', async () => {
    const tool = createReadFileTool();
    const output = await tool.execute('package.json', createCtx());
    expect(output).toContain('"name"');
    expect(output).toContain('code_agent');
  });

  it('fails when attempting to read a directory path', async () => {
    const tool = createReadFileTool();
    await expect(tool.execute('src', createCtx())).rejects.toThrow('Cannot read a directory');
  });

  it('writes a file relative to the repo root', async () => {
    const targetPath = path.join(tempDir, 'example.txt');
    const relativeTarget = path.relative(process.cwd(), targetPath);
    const payload = {
      path: relativeTarget,
      contents: 'hello tools test'
    };
    const tool = createWriteFileTool();
    const result = await tool.execute(JSON.stringify(payload), createCtx());
    const contents = await fs.readFile(targetPath, 'utf8');

    expect(result).toContain('Wrote');
    expect(contents).toBe('hello tools test');
  });

  it('prevents writing outside of the repository root', async () => {
    const payload = {
      path: '../outside.txt',
      contents: 'nope'
    };
    const tool = createWriteFileTool();
    await expect(tool.execute(JSON.stringify(payload), createCtx())).rejects.toThrow(
      'Access outside of repository root'
    );
  });
});

describe('node execution tools', () => {
  it('runs arbitrary JavaScript via node tool', async () => {
    const tool = createNodeTool();
    const output = await tool.execute('return 21 * 2;', createCtx());
    expect(output).toContain('Result');
    expect(output).toContain('42');
  });

  it('captures console output for user-visible node tool', async () => {
    const tool = createNodeUserVisibleTool();
    const output = await tool.execute("console.log('node hello');", createCtx());
    expect(output.trim()).toBe('node hello');
  });

  it('prevents exiting the host process', async () => {
    const tool = createNodeTool();
    await expect(tool.execute('process.exit(1);', createCtx())).rejects.toThrow(
      'process.exit(1) is not allowed'
    );
  });
});

describe('file search tool', () => {
  it('finds known text within the repo', async () => {
    const tool = createFileSearchTool();
    const payload = {
      pattern: 'Code Agent CLI',
      path: 'src'
    };
    const result = await tool.execute(JSON.stringify(payload), createCtx());
    expect(result).toContain('Code Agent CLI');
  });

  it('returns a friendly message when no matches are found', async () => {
    const tool = createFileSearchTool();
    const payload = {
      pattern: '__unlikely_pattern__'
    };
    const result = await tool.execute(JSON.stringify(payload), createCtx());
    expect(result).toBe('No matches found.');
  });
});

describe('web tool', () => {
  it('fetches local file content using curl', async () => {
    const tool = createWebTool();
    const htmlPath = path.join(tempDir, 'web-source.html');
    await fs.writeFile(htmlPath, '<html><body>Local Fixture</body></html>', 'utf8');
    const payload = {
      url: new URL(`file://${htmlPath}`).href
    };
    const message = await tool.execute(JSON.stringify(payload), createCtx());

    if (message.includes('curl is not available')) {
      return;
    }

    expect(message).toContain('Local Fixture');
  });
});

describe('placeholder integrations', () => {
  it('returns placeholder messaging for image generation tool', async () => {
    const tool = createImageGenTool();
    const message = await tool.execute('', createCtx());
    expect(message.toLowerCase()).toContain('not configured');
  });

  it('returns placeholder messaging for automations tool', async () => {
    const tool = createAutomationsTool();
    const message = await tool.execute('', createCtx());
    expect(message.toLowerCase()).toContain('automations');
  });

  it('returns placeholder messaging for bio tool', async () => {
    const tool = createBioTool();
    const message = await tool.execute('', createCtx());
    expect(message.toLowerCase()).toContain('bio');
  });
});

describe('path utilities', () => {
  it('resolves repository-relative paths safely', () => {
    const ctx = createCtx();
    const resolved = resolveRepoPath('src', ctx);
    expect(resolved.startsWith(process.cwd())).toBe(true);
  });

  it('prevents escaping the repository root', () => {
    const ctx = createCtx();
    expect(() => resolveRepoPath('..', ctx)).toThrow('Access outside of repository root');
  });

  it('formats repo-relative paths for display', () => {
    const ctx = createCtx();
    const absolute = resolveRepoPath('src/index.tsx', ctx);
    const relative = pathFromRepoRoot(absolute, ctx);
    expect(relative).toBe(path.join('src', 'index.tsx'));
  });
});
