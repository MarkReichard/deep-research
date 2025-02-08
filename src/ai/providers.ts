import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';

interface CustomOpenAIProviderSettings extends OpenAIProviderSettings {
  baseURL?: string;
}

// Providers
const openai = createOpenAI({
  apiKey: process.env.OPENAI_KEY!,
  baseURL: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1',
} as CustomOpenAIProviderSettings);

const isCustomEndpoint = process.env.OPENAI_ENDPOINT !== 'https://api.openai.com/v1';
const modelName = isCustomEndpoint && process.env.OPENAI_MODEL ? process.env.OPENAI_MODEL : 'o3-mini';

const modelOptions:any = {
  structuredOutputs: true,
  ...(modelName === 'o3-mini' && { reasoningEffort: 'medium' }),
};

// Models
export const aiModelToUse = openai(
  modelName,
  modelOptions,
);


