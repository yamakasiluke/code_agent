import type {ChatMessage, Tool} from './types.js';

const FORMAT_GUIDE = `Use the ReAct pattern to solve the task.
Respond using the following blocks:
Thought: describe what you are considering.
Action: the name of a tool, exactly matching one of the provided tools.
Action Input: plain text arguments for the tool.

If you have finished, reply with:
Thought: describe how you solved it.
Final Response: the final answer for the user.`;

const SAFETY_RULES = `- Think before acting; never guess commands.
- Prefer reading files before writing to them.
- Execute at most one tool per response.
- Keep Action Input short and actionable.
- Never fabricate tool names or capabilities.`;

export interface ReactPromptOptions {
  instructions: string;
  tools: Tool[];
  task: string;
  scratchpad?: string;
  contextMessages?: ChatMessage[];
}

export const buildReactMessages = ({
  instructions,
  tools,
  task,
  scratchpad,
  contextMessages = []
}: ReactPromptOptions): ChatMessage[] => {
  const toolDescriptions = tools
    .map(tool => {
      const guide = tool.inputGuide ? `\nInput: ${tool.inputGuide}` : '';
      return `- ${tool.name}: ${tool.description}${guide}`;
    })
    .join('\n');

  const systemPrompt = `You are an autonomous coding agent.
${instructions.trim()}

Available tools:\n${toolDescriptions}\n\n${FORMAT_GUIDE}\n\n${SAFETY_RULES}`;

  const scratchpadBlock = scratchpad?.trim().length
    ? `\n\nScratchpad:\n${scratchpad}`
    : '';

  return [
    {role: 'system', content: systemPrompt},
    ...contextMessages,
    {role: 'user', content: `${task.trim()}${scratchpadBlock}`}
  ];
};
