import {config as loadEnvConfig} from 'dotenv';

loadEnvConfig();

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
}

export const loadDeepSeekConfig = (): DeepSeekConfig => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY in the environment.');
  }

  const model = process.env.DEEPSEEK_MODEL?.trim() ?? 'deepseek-chat';

  return {apiKey, model};
};
