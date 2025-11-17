import type {LanguageModel} from '../agent/agent.js';
import type {ChatMessage} from '../agent/types.js';

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    message?: {
      role: string;
      content: string;
    };
  }>;
  error?: {
    message: string;
    type?: string;
  };
}

export interface DeepSeekClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

export class DeepSeekClient implements LanguageModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;

  constructor(options: DeepSeekClientOptions) {
    if (!options.apiKey) {
      throw new Error('DeepSeek API key is required.');
    }

    this.apiKey = options.apiKey;
    this.model = options.model ?? 'deepseek-chat';
    this.baseUrl = options.baseUrl ?? 'https://api.deepseek.com/v1';
    this.temperature = options.temperature ?? 0.1;
  }

  async complete(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature
      }),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as DeepSeekChatCompletionResponse;
    const message = payload.choices?.[0]?.message?.content?.trim();

    if (!message) {
      const details = payload.error?.message ?? 'Empty completion payload.';
      throw new Error(`DeepSeek response missing content: ${details}`);
    }

    return message;
  }
}
