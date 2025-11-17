export type ReactResponse =
  | {
      kind: 'action';
      thought: string;
      toolName: string;
      toolInput: string;
    }
  | {
      kind: 'final';
      thought: string;
      finalResponse: string;
    };

const extractThought = (output: string): string => {
  const thoughtMatch = output.match(/Thought:\s*([\s\S]*?)(?:\n[A-Z][^:]+:|$)/i);
  return thoughtMatch ? thoughtMatch[1].trim() : '';
};

export const parseReactOutput = (output: string): ReactResponse => {
  const trimmed = output.trim();
  const thought = extractThought(trimmed);

  const finalMatch = trimmed.match(/Final Response:\s*([\s\S]+)/i);
  if (finalMatch) {
    return {
      kind: 'final',
      thought,
      finalResponse: finalMatch[1].trim()
    };
  }

  const actionMatch = trimmed.match(/Action:\s*([^\n]+)\nAction Input:\s*([\s\S]+)/i);
  if (actionMatch) {
    return {
      kind: 'action',
      thought,
      toolName: actionMatch[1].trim(),
      toolInput: actionMatch[2].trim()
    };
  }

  throw new Error('Unable to parse LLM response into ReAct action.');
};
