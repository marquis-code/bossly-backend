import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Fuse from 'fuse.js';
import { Product, ProductDocument } from '../products/product.schema';
import { LlmParserService } from './llm-parser.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';

export interface ParsedCatalogItem {
  productId: string;
  variantId: string;
  name: string;
  variantName: string;
  quantity: number;
  unitPriceKobo: number;
  quotedUnitPriceKobo: number | null;
  confidence: number;
  rawPhrase: string;
}

export interface ParsedChatDraft {
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  items: ParsedCatalogItem[];
  unmatched: { phrase: string; quantity: number; reason: string; guessedUnitPriceKobo: number | null }[];
  discountKobo: number;
  deliveryFeeKobo: number;
  amountPaidKobo: number | null;
  amountOwedKobo: number | null;
  dueDate: string;
  notes: string;
  parserUsed: 'heuristic' | 'llm';
  confidence: number;
  rawText: string;
  totals: { subtotalKobo: number; discountKobo: number; deliveryFeeKobo: number; totalKobo: number };
  warnings: string[];
}

@Injectable()
export class ChatParserService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    private readonly llm: LlmParserService,
  ) {}

  async parse(businessId: string, text: string, opts: { allowLlm?: boolean } = {}): Promise<ParsedChatDraft> {
    const cleanText = String(text || '').slice(0, 8000).trim();
    if (!cleanText) throw new BadRequestException('Paste a WhatsApp conversation first.');
    const catalog = await this.products.find({ businessId, isActive: true }).lean().exec();
    const heuristic = this.heuristicParse(cleanText, catalog as unknown as Product[]);
    let draft = heuristic;
    if (opts.allowLlm !== false && this.llm.isConfigured && (heuristic.items.length === 0 || heuristic.unmatched.length > 0 || heuristic.confidence < 0.55)) {
      const llmResult = await this.llm.parseChat(
        cleanText,
        catalog.map((p) => ({
          name: p.name,
          variants: p.variants.map((v) => v.name),
          priceKobo: p.priceKobo,
        })),
      );
      if (llmResult && llmResult.items.length > 0) {
        const llmDraft = this.mergeLlmResult(cleanText, catalog as unknown as Product[], heuristic, llmResult);
        if (llmDraft.items.length > heuristic.items.length || llmDraft.unmatched.length < heuristic.unmatched.length) {
          draft = llmDraft;
        }
      }
    }
    return this.finalise(cleanText, draft);
  }

  private heuristicParse(text: string, catalog: Product[]): ParsedChatDraft {
    const phone = this.extractPhone(text);
    const customerName = this.extractName(text);
    const address = this.extractAddress(text);
    const deliveryFeeKobo = this.extractTaggedAmount(text, ['delivery', 'shipping', 'dispatch']);
    const amountOwedKobo = this.extractTaggedAmount(text, ['owes', 'owing', 'balance', 'remainder', 'remaining']);
    const paidKobo = this.extractTaggedAmount(text, ['paid', 'deposit', 'part payment']);
    const items: ParsedCatalogItem[] = [];
    const unmatched: ParsedChatDraft['unmatched'] = [];
    const masked = this.maskNonItems(text).replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
    const segments = masked
      .split(/\n|,|;|\band\b|\bplus\b|\bwith\b/i)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const segment of segments) {
      if (segment.length < 2) continue;
      const quantity = this.extractQuantity(segment);
      const phrase = this.cleanItemPhrase(segment);
      if (!phrase || phrase.length < 2) continue;
      if (!quantity && !this.hasCatalogMention(phrase, catalog)) continue;
      const match = this.matchProduct(phrase, catalog);
      if (match) {
        if (items.some((i) => i.variantId === match.variantId)) {
          const existing = items.find((i) => i.variantId === match.variantId)!;
          existing.quantity += quantity || 1;
          continue;
        }
        const quoted = this.extractUnitPrice(segment, quantity || 1);
        items.push({
          productId: match.productId,
          variantId: match.variantId,
          name: match.name,
          variantName: match.variantName,
          quantity: quantity || 1,
          unitPriceKobo: match.unitPriceKobo,
          quotedUnitPriceKobo: quoted,
          confidence: match.confidence,
          rawPhrase: segment.slice(0, 200),
        });
      } else if (quantity > 0 && this.looksLikeItem(phrase)) {
        unmatched.push({
          phrase: phrase.slice(0, 120),
          quantity,
          reason: 'No product in your catalogue matches this. Add it, or pick a similar product before confirming.',
          guessedUnitPriceKobo: this.extractUnitPrice(segment, quantity),
        });
      }
    }

    return {
      customerName,
      customerPhone: phone,
      deliveryAddress: address,
      items,
      unmatched,
      discountKobo: 0,
      deliveryFeeKobo: deliveryFeeKobo || 0,
      amountPaidKobo: paidKobo,
      amountOwedKobo,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      notes: text.slice(0, 1000),
      parserUsed: 'heuristic',
      confidence: items.length ? Math.min(0.95, 0.5 + items.reduce((s, i) => s + i.confidence, 0) / items.length / 2) : 0,
      rawText: text,
      totals: { subtotalKobo: 0, discountKobo: 0, deliveryFeeKobo: 0, totalKobo: 0 },
      warnings: [],
    };
  }

  private mergeLlmResult(
    text: string,
    catalog: Product[],
    heuristic: ParsedChatDraft,
    llm: Awaited<ReturnType<LlmParserService['parseChat']>>,
  ): ParsedChatDraft {
    if (!llm) return heuristic;
    const items: ParsedCatalogItem[] = [];
    const unmatched: ParsedChatDraft['unmatched'] = [];
    for (const raw of llm.items) {
      const match = this.matchProduct(raw.phrase, catalog);
      if (!match) {
        unmatched.push({
          phrase: raw.phrase,
          quantity: raw.quantity,
          reason: 'The AI found this item in the chat but it is not in your catalogue.',
          guessedUnitPriceKobo: raw.unitPriceKobo ?? null,
        });
        continue;
      }
      if (items.some((i) => i.variantId === match.variantId)) {
        items.find((i) => i.variantId === match.variantId)!.quantity += raw.quantity;
        continue;
      }
      items.push({
        productId: match.productId,
        variantId: match.variantId,
        name: match.name,
        variantName: match.variantName,
        quantity: raw.quantity,
        unitPriceKobo: match.unitPriceKobo,
        quotedUnitPriceKobo: raw.unitPriceKobo ?? null,
        confidence: match.confidence,
        rawPhrase: raw.phrase,
      });
    }
    return {
      customerName: llm.customerName || heuristic.customerName,
      customerPhone: llm.customerPhone ? normalizeNigerianPhone(llm.customerPhone) || heuristic.customerPhone : heuristic.customerPhone,
      deliveryAddress: llm.address || heuristic.deliveryAddress,
      items,
      unmatched,
      discountKobo: 0,
      deliveryFeeKobo: heuristic.deliveryFeeKobo,
      amountPaidKobo: llm.amountPaidKobo ?? heuristic.amountPaidKobo,
      amountOwedKobo: llm.amountOwedKobo ?? heuristic.amountOwedKobo,
      dueDate: heuristic.dueDate,
      notes: llm.notes || text.slice(0, 1000),
      parserUsed: 'llm',
      confidence: llm.confidence,
      rawText: text,
      totals: { subtotalKobo: 0, discountKobo: 0, deliveryFeeKobo: 0, totalKobo: 0 },
      warnings: [],
    };
  }

  private finalise(text: string, draft: ParsedChatDraft): ParsedChatDraft {
    const subtotal = draft.items.reduce((s, i) => s + i.unitPriceKobo * i.quantity, 0);
    const quotedSubtotal = draft.items.reduce(
      (s, i) => s + (i.quotedUnitPriceKobo ?? i.unitPriceKobo) * i.quantity,
      0,
    );
    let discount = draft.discountKobo;
    if (quotedSubtotal > 0 && quotedSubtotal < subtotal) discount = subtotal - quotedSubtotal;
    const total = Math.max(0, subtotal - discount + draft.deliveryFeeKobo);
    const warnings: string[] = [];
    if (draft.items.length === 0) warnings.push('No catalogue items were found in this chat.');
    if (draft.unmatched.length) warnings.push(`${draft.unmatched.length} item${draft.unmatched.length === 1 ? '' : 's'} could not be matched.`);
    if (!draft.customerPhone) warnings.push('No Nigerian phone number found. Add one so you can send reminders.');
    if (!draft.customerName) warnings.push('No customer name found.');
    if (draft.amountOwedKobo && draft.amountOwedKobo > total) warnings.push('The amount owed is larger than the matched order total. Check the chat.');
    return {
      ...draft,
      notes: draft.notes || text.slice(0, 1000),
      totals: { subtotalKobo: subtotal, discountKobo: discount, deliveryFeeKobo: draft.deliveryFeeKobo, totalKobo: total },
      confidence: Math.round(draft.confidence * 100) / 100,
      warnings,
    };
  }

  matchProduct(phrase: string, catalog: Product[]): ParsedCatalogItem | null {
    if (!phrase || !catalog.length) return null;
    const normalized = this.normalize(phrase);
    const phraseTokens = normalized.split(' ').filter((t) => t.length > 2);
    if (!normalized) return null;
    const singular = (t: string) => t.replace(/ies$/, 'y').replace(/s$/, '');
    let best: { product: Product; variant: Product['variants'][number]; score: number } | null = null;

    for (const product of catalog) {
      const productName = this.normalize(product.name);
      const variants = product.variants.filter((v) => v.isActive);
      const variant = variants.find((v) => this.normalize(v.name) && normalized.includes(this.normalize(v.name))) ||
        variants.find((v) => {
          const attrs = Object.values(v.attributes || {});
          return attrs.length > 0 && attrs.every((attr) => attr && normalized.includes(this.normalize(attr)));
        }) ||
        variants[0];
      if (!variant) continue;
      let score = 0;
      if (normalized === productName || normalized.includes(productName)) score = 1;
      else {
        const pTokens = productName.split(' ').filter((t) => t.length > 2);
        const matchedTokens = pTokens.filter((t) =>
          phraseTokens.some((pt) => pt === t || singular(pt) === singular(t) || (t.length >= 4 && pt.includes(t))),
        ).length;
        if (matchedTokens > 0 && pTokens.length > 0) {
          score = 0.55 + 0.45 * (matchedTokens / pTokens.length);
          if (phraseTokens.length === 1 && pTokens.some((t) => singular(t) === singular(phraseTokens[0]))) {
            score = Math.max(score, 0.72);
          }
        }
      }
      if (score > (best?.score || 0)) best = { product, variant, score };
    }

    if (best && best.score >= 0.55) {
      return {
        productId: (best.product as unknown as { _id: { toString(): string } })._id.toString(),
        variantId: best.variant._id!.toString(),
        name: best.product.name,
        variantName: best.variant.name,
        quantity: 1,
        unitPriceKobo: best.variant.priceKobo,
        quotedUnitPriceKobo: null,
        confidence: Math.min(0.99, Math.max(0.55, best.score)),
        rawPhrase: phrase,
      };
    }

    // Typo fallback: only accept a genuinely close product name.
    const fuse = new Fuse(catalog.map((product) => ({ product, name: product.name })), {
      keys: ['name'],
      threshold: 0.38,
      ignoreLocation: true,
      includeScore: true,
    });
    const result = fuse.search(phrase)[0];
    if (!result || (result.score ?? 1) > 0.38) return null;
    const product = result.item.product;
    const variant = product.variants.filter((v) => v.isActive)[0];
    if (!variant) return null;
    return {
      productId: (product as unknown as { _id: { toString(): string } })._id.toString(),
      variantId: variant._id!.toString(),
      name: product.name,
      variantName: variant.name,
      quantity: 1,
      unitPriceKobo: variant.priceKobo,
      quotedUnitPriceKobo: null,
      confidence: Math.min(0.8, Math.max(0.5, 1 - result.score! * 1.2)),
      rawPhrase: phrase,
    };
  }

  private extractPhone(text: string): string | null {
    const matches = text.match(/(?:\+?234|0)[789][01]\d{8}/g);
    if (!matches) return null;
    for (const match of matches) {
      const normalized = normalizeNigerianPhone(match);
      if (normalized) return normalized;
    }
    return null;
  }

  private extractName(text: string): string | null {
    const patterns = [
      /([a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?)\s+(?:owes?|owing|debt|balance)/i,
      /(?:my name is|i am|i'm|this is|call me)\s+([a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?)/i,
      /(?:customer|name)\s*[:\-]\s*([a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?)/i,
      /(?:for|to)\s+([a-zA-Z][a-zA-Z0-9'.-]+)\s*(?:,|\.|$)/im,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const name = match[1].trim();
        if (!/^(Lagos|Abuja|Nigeria|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Customer|Someone)$/i.test(name)) {
          return name.charAt(0).toUpperCase() + name.slice(1);
        }
      }
    }
    return null;
  }

  private extractAddress(text: string): string | null {
    const match = text.match(/(?:deliver(?:y)?(?:\s+to)?|address\s*[:\-]?|location\s*[:\-]?|drop(?:\s*off)?(?:\s+at)?|send\s+to)\s+([^.\n,;]{3,120})/i);
    if (!match?.[1]) return null;
    return match[1].replace(/\s+/g, ' ').trim();
  }

  private extractQuantity(segment: string): number {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
    const numeric = segment.match(/(?:^|\s)(\d{1,4})\s*(?:x|pcs?|pieces?|units?|pairs?|bags?|cartons?)?\s+/i) ||
      segment.match(/(?:^|\s)(\d{1,4})\s*(?:x|pcs?|pieces?|units?|pairs?|bags?|cartons?)\b/i);
    if (numeric) return parseInt(numeric[1], 10);
    const word = segment.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
    if (word) return words[word[1].toLowerCase()] || 1;
    return 0;
  }

  private extractUnitPrice(segment: string, quantity: number): number | null {
    const withoutPhone = segment.replace(/(?:\+?234|0)[789][01]\d{8}/g, ' ');
    const amounts: number[] = [];
    for (const match of withoutPhone.matchAll(/(?:₦|ngn|\bN)?\s*(\d[\d,]{2,})(?:\.(\d{1,2}))?|\b(\d+(?:\.\d+)?)k\b/gi)) {
      if (match[3]) amounts.push(Math.round(Number(match[3]) * 100000));
      else {
        const naira = Number(match[1].replace(/,/g, '') + (match[2] ? `.${match[2]}` : ''));
        if (Number.isFinite(naira) && naira >= 1) amounts.push(Math.round(naira * 100));
      }
    }
    if (!amounts.length) return null;
    const quantityNumbers = new Set([quantity, quantity * 100]);
    let price = amounts.filter((a) => !quantityNumbers.has(a) && a !== quantity)[0] || amounts[0];
    if (!price || price < 10000) return null;
    if (/\b(total|altogether|for all|in all)\b/i.test(segment) && quantity > 0) {
      price = Math.round(price / quantity);
    }
    return price;
  }

  private extractTaggedAmount(text: string, tags: string[]): number | null {
    for (const tag of tags) {
      const regex = new RegExp(`${tag}\\s*(?:of|is|:)?\\s*(?:₦|ngn|N)?\\s*(\\d[\\d,]*(?:\\.\\d{1,2})?)`, 'i');
      const match = text.match(regex);
      if (match?.[1]) {
        const value = Number(match[1].replace(/,/g, ''));
        if (Number.isFinite(value) && value > 0) return Math.round(value * 100);
      }
    }
    return null;
  }

  private maskNonItems(text: string): string {
    let masked = text;
    masked = masked.replace(/(?:\+?234|0)[789][01]\d{8}/g, ' ');
    masked = masked.replace(/(?:my name is|i am|i'm|this is|call me|name\s*:)\s+[a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?/gi, ' ');
    masked = masked.replace(/(?:deliver(?:y)?(?:\s+to)?|address\s*[:\-]?|location\s*[:\-]?|drop(?:\s*off)?(?:\s+at)?)\s+[^.\n,;]{3,120}/gi, ' ');
    masked = masked.replace(/(?:[a-zA-Z][a-zA-Z0-9'.-]+(?:\s+[a-zA-Z][a-zA-Z0-9'.-]+)?\s+)?(?:owes?|owing|debt|balance)\s+(?:₦|ngn|N)?\s*\d[\d,]*/gi, ' ');
    masked = masked.replace(/\b(?:i\s+)?(?:have\s+)?(?:paid|deposit)\s+(?:₦|ngn|N)?\s*\d[\d,]*/gi, ' ');
    masked = masked.replace(/\b(?:delivery|shipping|dispatch)\s*(?:fee)?\s*(?:₦|ngn|N)?\s*\d[\d,]*/gi, ' ');
    masked = masked.replace(/\b(?:due|pay later|next week|tomorrow|today)\b/gi, ' ');
    return masked;
  }

  private cleanItemPhrase(segment: string): string {
    return this.normalize(
      segment
        .replace(/(?:₦|ngn|\bN)?\s*\d[\d,]*(?:\.\d{1,2})?k?/gi, ' ')
        .replace(/\b(?:please|abeg|i want|i need|want|need|order|buy|get|for|the|of|my|me|send|deliver|to|at|each|total|pcs|pieces?|units?|and|plus|with|current|price|how much|is|are|do you have|available)\b/gi, ' ')
        .replace(/\s+/g, ' '),
    );
  }

  private hasCatalogMention(phrase: string, catalog: Product[]): boolean {
    return catalog.some((p) => {
      const name = this.normalize(p.name);
      return name.includes(phrase) || phrase.includes(name) || name.split(' ').filter((t) => t.length > 2).every((t) => phrase.includes(t));
    });
  }

  private looksLikeItem(phrase: string): boolean {
    if (!phrase || phrase.length < 3) return false;
    return !/(?:owes?|paid|deliver|address|phone|thanks?|please|hello|hi|good|morning|afternoon|evening|price|how much)/i.test(phrase);
  }

  private normalize(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s/&-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
