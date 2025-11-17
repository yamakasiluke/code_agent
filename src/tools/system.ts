import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import util from 'node:util';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import type {Tool, ToolExecutionContext} from '../agent/types.js';
import {resolveRepoPath} from './pathUtils.js';

const MAX_OUTPUT_LENGTH = 4000;
const MAX_MATCHES = 100;
const MAX_FILE_BYTES = 500_000;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo']);
const WEB_FETCH_LIMIT = 8000;

const truncate = (value: string) =>
  value.length > MAX_OUTPUT_LENGTH ? `${value.slice(0, MAX_OUTPUT_LENGTH)}\n...truncated...` : value;

const formatValue = (value: unknown): string => {
  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string') {
    return value;
  }

  return util.inspect(value, {depth: 3, maxArrayLength: 20});
};

const createConsoleRecorder = () => {
  const logs: string[] = [];
  const record = (...args: unknown[]) => {
    logs.push(util.format(...args));
  };

  const consoleLike: Pick<typeof console, 'log' | 'info' | 'warn' | 'error' | 'debug' | 'dir'> = {
    log: record,
    info: record,
    warn: record,
    error: record,
    debug: record,
    dir: record
  };

  return {logs, consoleLike};
};

const createSandboxProcess = (ctx: ToolExecutionContext) => ({
  env: {...process.env, ...(ctx.env ?? {})},
  cwd: () => resolveRepoPath('.', ctx),
  exit: (code = 0) => {
    throw new Error(`process.exit(${code}) is not allowed inside the node tool.`);
  }
});

const runUserNodeSnippet = async (code: string, ctx: ToolExecutionContext) => {
  const snippet = code.trim();
  if (!snippet.length) {
    throw new Error('Provide JavaScript code to execute.');
  }

  const {logs, consoleLike} = createConsoleRecorder();
  const repoRoot = resolveRepoPath('.', ctx);
  let sandboxRequire: NodeJS.Require;
  try {
    sandboxRequire = createRequire(path.join(repoRoot, 'package.json'));
  } catch {
    sandboxRequire = createRequire(import.meta.url);
  }

  const sandbox = {
    console: consoleLike,
    require: sandboxRequire,
    process: createSandboxProcess(ctx),
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  } satisfies Record<string, unknown>;

  const context = vm.createContext(sandbox);
  const asyncBlock = `(async () => {\n${snippet}\n})()`;
  const script = new vm.Script(asyncBlock, {filename: 'agent-node-tool.mjs'});
  const result = await script.runInContext(context);

  return {result, logs};
};

export const createNodeTool = (): Tool => ({
  name: 'node',
  description: 'Execute arbitrary JavaScript snippets inside a Node.js sandbox (supports await).',
  inputGuide: 'Write JavaScript/TypeScript-compatible code. Console output is captured.',
  async execute(input, ctx) {
    const {result, logs} = await runUserNodeSnippet(input, ctx);
    const sections = [] as string[];

    if (logs.length) {
      sections.push(`Console output:\n${truncate(logs.join('\n'))}`);
    }

    sections.push(`Result:\n${formatValue(result)}`);
    return sections.join('\n\n');
  }
});

export const createNodeUserVisibleTool = (): Tool => ({
  name: 'node_user_visible',
  description: 'Run JavaScript intended to print output directly for the user.',
  inputGuide: 'Use console.log to print the response users should see.',
  async execute(input, ctx) {
    const {result, logs} = await runUserNodeSnippet(input, ctx);
    if (logs.length) {
      return truncate(logs.join('\n'));
    }
    return formatValue(result);
  }
});

interface FileSearchPayload {
  pattern: string;
  path?: string;
  flags?: string;
}

const parseFileSearchInput = (input: string): FileSearchPayload => {
  try {
    const payload = JSON.parse(input) as Partial<FileSearchPayload>;
    if (!payload || typeof payload.pattern !== 'string' || !payload.pattern.trim()) {
      throw new Error('Missing "pattern" field.');
    }
    if (payload.path && typeof payload.path !== 'string') {
      throw new Error('"path" must be a string when provided.');
    }
    if (payload.flags && typeof payload.flags !== 'string') {
      throw new Error('"flags" must be a string when provided.');
    }
    return {
      pattern: payload.pattern.trim(),
      path: payload.path?.trim(),
      flags: payload.flags?.trim()
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON. Expect {"pattern": "TODO", "path": "src"}.');
    }
    throw error;
  }
};

const buildRegex = (pattern: string, flags?: string): RegExp => {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${(error as Error).message}`);
  }
};

const shouldSkipDir = (entry: string) => IGNORED_DIRS.has(entry);

const searchFileForPattern = async (filePath: string, regex: RegExp) => {
  const matches: string[] = [];
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      return matches;
    }
    const contents = await fs.readFile(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (regex.test(line)) {
        matches.push(`${index + 1}: ${line}`);
      }
      regex.lastIndex = 0; // reset for global regex
    }
    return matches;
  } catch (error) {
    return [`error reading ${filePath}: ${(error as Error).message}`];
  }
};

const collectMatches = async (root: string, regex: RegExp, ctx: ToolExecutionContext) => {
  const queue: string[] = [root];
  const results: string[] = [];

  while (queue.length && results.length < MAX_MATCHES) {
    const current = queue.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(current, {withFileTypes: true});
    } catch (error) {
      results.push(`${path.relative(ctx.cwd, current)}: error reading directory: ${(error as Error).message}`);
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          queue.push(path.join(current, entry.name));
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(current, entry.name);
      const fileMatches = await searchFileForPattern(filePath, regex);
      for (const match of fileMatches) {
        results.push(`${path.relative(ctx.cwd, filePath)}:${match}`);
        if (results.length >= MAX_MATCHES) {
          break;
        }
      }
      if (results.length >= MAX_MATCHES) {
        break;
      }
    }
  }

  return results;
};

export const createFileSearchTool = (): Tool => ({
  name: 'file_search',
  description: 'Search for a regex pattern inside the repository using pure Node.js file scanning.',
  inputGuide: 'JSON: {"pattern": "TODO", "path": "src", "flags": "i"}',
  async execute(input, ctx) {
    const payload = parseFileSearchInput(input);
    const regex = buildRegex(payload.pattern, payload.flags);
    const root = payload.path ? resolveRepoPath(payload.path, ctx) : resolveRepoPath('.', ctx);
    const matches = await collectMatches(root, regex, ctx);
    if (!matches.length) {
      return 'No matches found.';
    }
    return truncate(matches.join('\n'));
  }
});

interface WebFetchPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: string;
}

const parseWebFetchInput = (input: string): WebFetchPayload => {
  if (!input.trim()) {
    throw new Error('Provide JSON with at least a "url" field.');
  }

  try {
    const payload = JSON.parse(input) as Partial<WebFetchPayload>;
    if (!payload || typeof payload.url !== 'string' || !payload.url.trim()) {
      throw new Error('Missing "url" string field.');
    }
    if (payload.headers) {
      for (const [key, value] of Object.entries(payload.headers)) {
        if (typeof value !== 'string') {
          throw new Error(`Header ${key} must be a string value.`);
        }
      }
    }
    if (payload.method && typeof payload.method !== 'string') {
      throw new Error('"method" must be a string when provided.');
    }
    if (payload.data && typeof payload.data !== 'string') {
      throw new Error('"data" must be a string when provided.');
    }

    return {
      url: payload.url.trim(),
      method: payload.method?.trim().toUpperCase(),
      headers: payload.headers,
      data: payload.data
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON. Provide {"url": "https://example.com"}.');
    }
    throw error;
  }
};

const runCurlRequest = (payload: WebFetchPayload, ctx: ToolExecutionContext) =>
  new Promise<string>((resolve, reject) => {
    const args: string[] = ['-sSL'];
    const method = payload.method ?? (payload.data ? 'POST' : 'GET');
    args.push('-X', method);

    if (payload.headers) {
      for (const [key, value] of Object.entries(payload.headers)) {
        args.push('-H', `${key}: ${value}`);
      }
    }

    if (payload.data) {
      args.push('--data', payload.data);
    }

    args.push(payload.url);

    const child = spawn('curl', args, {
      cwd: ctx.cwd,
      env: {...process.env, ...(ctx.env ?? {})},
      stdio: 'pipe',
      signal: ctx.signal
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk as string;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk as string;
    });

    child.on('error', error => {
      reject(error);
    });

    child.on('close', exitCode => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `curl exited with code ${exitCode}`));
        return;
      }
      resolve(stdout);
    });
  });

const placeholderMessage = (integrationName: string) =>
  `${integrationName} integration is not configured yet. Provide API credentials and implementation.`;

const createPlaceholderTool = (name: string, description: string): Tool => ({
  name,
  description,
  inputGuide: 'Provide the payload required by the integration (not yet implemented).',
  async execute() {
    return placeholderMessage(name);
  }
});

export const createWebTool = (): Tool => ({
  name: 'web',
  description: 'Fetch webpage contents via curl. Provide a URL and optional method/headers.',
  inputGuide: 'JSON: {"url": "https://example.com", "method": "GET", "headers": {"Accept": "text/html"}}',
  async execute(input, ctx) {
    const payload = parseWebFetchInput(input);
    try {
      const body = await runCurlRequest(payload, ctx);
      const trimmed = body.trim();
      if (!trimmed.length) {
        return `curl succeeded for ${payload.url} but returned no body.`;
      }
      return trimmed.length > WEB_FETCH_LIMIT ? `${trimmed.slice(0, WEB_FETCH_LIMIT)}\n...truncated...` : trimmed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 'curl is not available in this environment.';
      }
      return `Failed to fetch ${payload.url}: ${(error as Error).message}`;
    }
  }
});

export const createImageGenTool = (): Tool =>
  createPlaceholderTool('image_gen', 'Generate images from textual prompts via a model like SD or DALL·E.');

export const createAutomationsTool = (): Tool =>
  createPlaceholderTool('automations', 'Trigger business automations or workflows (Zapier, Slack, etc.).');

export const createGmailTool = (): Tool =>
  createPlaceholderTool('gmail', 'Read or send mail via Gmail APIs.');

export const createGCalTool = (): Tool =>
  createPlaceholderTool('gcal', 'Interact with Google Calendar events.');

export const createGContactsTool = (): Tool =>
  createPlaceholderTool('gcontacts', 'Query or edit Google Contacts.');

export const createCanmoreTool = (): Tool =>
  createPlaceholderTool('canmore', 'Access Canmore knowledge base or CRM data.');

export const createBioTool = (): Tool =>
  createPlaceholderTool('bio', 'Summarize biographical context about stakeholders.');
