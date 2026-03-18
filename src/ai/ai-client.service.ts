import { Injectable } from '@nestjs/common';
import { aiConfig, AiConfig } from './ai.config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiClientService {
  private config: AiConfig;

  constructor() {
    this.config = aiConfig();
  }

  /**
   * Call LLM (OpenAI) and return raw text. Returns null on failure or when disabled.
   */
  async complete(systemPrompt: string, userContent: string): Promise<string | null> {
    if (!this.config.enabled || !this.config.apiKey) return null;

    const url = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[AI] OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : null;
    } catch (err) {
      console.warn('[AI] LLM request failed', err);
      return null;
    }
  }
}
