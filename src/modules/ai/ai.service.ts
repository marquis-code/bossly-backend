import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ProductCopyInput { name: string; category?: string; imageUrl?: string; priceKobo?: number; businessName?: string; }

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly config: ConfigService) {}

  async productDescription(input: ProductCopyInput) {
    const fallback = this.fallback(input);
    const apiKey = this.config.get<string>('llm.apiKey');
    const baseUrl = String(this.config.get('llm.baseUrl') || '').replace(/\/$/, '');
    const model = String(this.config.get('llm.model') || '');
    if (!apiKey || !baseUrl || !model) return { ...fallback, usedAi: false };

    const prompt = `Write a warm, specific product description for a Nigerian small business. Product: ${input.name}. Category: ${input.category || 'general'}. Business: ${input.businessName || 'a small Nigerian business'}. Price: ${input.priceKobo ? `₦${Math.round(input.priceKobo / 100).toLocaleString('en-NG')}` : 'not specified'}. Return JSON only: {"description":"2-3 short sentences, no hype, no emojis","tags":["4-6 short lowercase search tags"]}. Do not invent materials, sizes, or guarantees that are not in the product name.`;
    try {
      const content = input.imageUrl
        ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: input.imageUrl } },
          ]
        : prompt;
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.5,
          max_tokens: 300,
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`AI ${response.status}`);
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI returned no JSON');
      const parsed = JSON.parse(match[0]) as { description?: string; tags?: string[] };
      if (!parsed.description) throw new Error('AI returned no description');
      return {
        description: parsed.description.trim().slice(0, 600),
        tags: (parsed.tags || fallback.tags).map((tag) => String(tag).toLowerCase().trim()).filter(Boolean).slice(0, 6),
        usedAi: true,
      };
    } catch (error) {
      this.logger.warn(`AI product description fell back: ${error instanceof Error ? error.message : 'unknown'}`);
      return { ...fallback, usedAi: false };
    }
  }

  private fallback(input: ProductCopyInput) {
    const category = input.category?.toLowerCase() || 'everyday';
    const price = input.priceKobo ? ` at ₦${Math.round(input.priceKobo / 100).toLocaleString('en-NG')}` : '';
    return {
      description: `${input.name} — a ${category} pick from ${input.businessName || 'our shop'}${price}. Made for everyday use, easy to order and delivered with care. Send a message if you want more details before you buy.`,
      tags: [input.name, category, 'student business', 'made in nigeria', 'shop small'].map((tag) => tag.toLowerCase()).slice(0, 6),
      usedAi: false,
    };
  }
}
