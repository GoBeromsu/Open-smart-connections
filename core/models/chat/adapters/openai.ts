/**
 * @file openai.ts
 * @description OpenAI chat adapter using Obsidian's requestUrl()
 */

import { ApiAdapter } from './_api_simplified';
import type { ModelInfo } from '../../../types/models';

const EXCLUDED_PREFIXES = [
  'text-', 'davinci', 'babbage', 'ada', 'curie', 'dall-e', 'whisper',
  'omni', 'tts', 'gpt-4o-mini-tts', 'computer-use', 'codex',
  'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-realtime',
  'gpt-4o-realtime', 'o4-mini-deep-research', 'o3-deep-research', 'gpt-image',
];

/**
 * OpenAI chat adapter
 */
export class OpenAIAdapter extends ApiAdapter {
  static key = 'openai';

  static defaults = {
    description: 'OpenAI',
    type: 'API',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    streaming: true,
    models_endpoint: 'https://api.openai.com/v1/models',
    default_model: 'gpt-5-nano',
    signup_url: 'https://platform.openai.com/api-keys',
  };

  adapter = 'openai';
  can_stream = true;

  models: Record<string, ModelInfo> = {
    'gpt-5-nano': {
      model_key: 'gpt-5-nano',
      model_name: 'GPT-5 Nano',
      max_tokens: 400_000,
    },
    'gpt-4o': {
      model_key: 'gpt-4o',
      model_name: 'GPT-4o',
      max_tokens: 128_000,
    },
    'gpt-4o-mini': {
      model_key: 'gpt-4o-mini',
      model_name: 'GPT-4o Mini',
      max_tokens: 128_000,
    },
  };


  protected parse_model_data(data: any): Record<string, ModelInfo> {
    if (!data.data || !Array.isArray(data.data)) {
      return this.models;
    }

    return data.data
      .filter((model: any) =>
        !EXCLUDED_PREFIXES.some(prefix => model.id.startsWith(prefix)) &&
        !model.id.includes('-instruct'),
      )
      .reduce((acc: Record<string, ModelInfo>, model: any) => {
        acc[model.id] = {
          model_key: model.id,
          model_name: model.id,
          max_tokens: this.get_max_input_tokens(model.id),
        };
        return acc;
      }, {});
  }

  private get_max_input_tokens(model_id: string): number {
    if (model_id.startsWith('gpt-4.1')) return 1_000_000;
    if (model_id.startsWith('o')) return 200_000;
    if (model_id.startsWith('gpt-5')) return 400_000;
    if (model_id.startsWith('gpt-4o') || model_id.startsWith('gpt-4.5') || model_id.startsWith('gpt-4-turbo')) {
      return 128_000;
    }
    if (model_id.startsWith('gpt-4')) return 8192;
    if (model_id.startsWith('gpt-3')) return 16385;
    return 8000;
  }
}
