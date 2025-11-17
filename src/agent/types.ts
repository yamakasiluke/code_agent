export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
}

export interface ToolExecutionContext {
  cwd: string;
  signal: AbortSignal;
  env?: Record<string, string>;
}

export interface Tool {
  name: string;
  description: string;
  inputGuide?: string;
  execute(input: string, context: ToolExecutionContext): Promise<string>;
}

export interface AgentConfig {
  instructions: string;
  tools: Tool[];
  maxTurns?: number;
}

export interface AgentThought {
  thought: string;
  action?: ToolInvocation;
  observation?: string;
  rawOutput?: string;
}

export interface ToolInvocation {
  toolName: string;
  input: string;
}

export interface AgentResult {
  output: string;
  thoughts: AgentThought[];
}
