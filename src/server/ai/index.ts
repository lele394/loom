import type { ProviderConfig } from '../modules/settings/service';
import type { AiProvider } from './types';
import { OpenAiProvider } from './openai';
import { FakeProvider } from './fake';

export function createProvider(config: ProviderConfig): AiProvider {
  if (config.kind === 'fake') return new FakeProvider(config);
  return new OpenAiProvider(config);
}
