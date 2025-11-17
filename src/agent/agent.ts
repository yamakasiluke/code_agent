import {buildReactMessages} from './reactPrompt.js';
import {parseReactOutput} from './reactParser.js';
import type {
  AgentConfig,
  AgentResult,
  AgentThought,
  ChatMessage,
  Tool,
  ToolExecutionContext
} from './types.js';

export interface LanguageModel {
  complete(messages: ChatMessage[], signal: AbortSignal): Promise<string>;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
}

export class ReactAgent {
  private readonly tools: Tool[];
  private readonly toolMap = new Map<string, Tool>();
  private readonly instructions: string;
  private readonly maxTurns: number;

  constructor(private readonly llm: LanguageModel, config: AgentConfig) {
    this.instructions = config.instructions;
    this.tools = config.tools;
    this.maxTurns = config.maxTurns ?? 8;

    for (const tool of this.tools) {
      this.toolMap.set(tool.name, tool);
    }
  }

  async run(task: string, options: AgentRunOptions = {}): Promise<AgentResult> {
    const signal = options.signal ?? new AbortController().signal;
    const cwd = options.cwd ?? process.cwd();
    const env = options.env;

    const thoughts: AgentThought[] = [];
    let scratchpad = '';

    for (let turn = 0; turn < this.maxTurns; turn += 1) {
      const messages = buildReactMessages({
        instructions: this.instructions,
        tools: this.tools,
        task,
        scratchpad
      });

      const llmOutput = await this.llm.complete(messages, signal);
      const parsed = parseReactOutput(llmOutput);

      if (parsed.kind === 'final') {
        thoughts.push({
          thought: parsed.thought,
          rawOutput: llmOutput
        });

        return {
          output: parsed.finalResponse,
          thoughts
        };
      }

      const tool = this.toolMap.get(parsed.toolName);
      if (!tool) {
        throw new Error(`LLM referenced unknown tool: ${parsed.toolName}`);
      }

      let observation: string;
      try {
        observation = await tool.execute(parsed.toolInput, {
          cwd,
          env,
          signal
        } satisfies ToolExecutionContext);
      } catch (error) {
        observation = `Tool execution failed: ${(error as Error).message}`;
      }

      thoughts.push({
        thought: parsed.thought,
        action: {
          toolName: parsed.toolName,
          input: parsed.toolInput
        },
        observation,
        rawOutput: llmOutput
      });

      const observationBlock = `Observation: ${observation}`;
      const turnScratch = [`Thought: ${parsed.thought}`, `Action: ${parsed.toolName}`, `Action Input: ${parsed.toolInput}`, observationBlock]
        .join('\n');

      scratchpad = scratchpad.length ? `${scratchpad}\n\n${turnScratch}` : turnScratch;
    }

    return {
      output: 'I could not finish within the allotted number of steps.',
      thoughts
    };
  }
}
