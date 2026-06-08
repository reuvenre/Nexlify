import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ProductsService } from '../products/products.service';

export interface RankedProduct {
  product_id: string;
  title: string;
  sale_price: number;
  original_price: number;
  discount_percent: number;
  orders_count: number;
  rating: number;
  image_url: string;
  category: string;
  currency: string;
  commission_rate: number;
  score: number;
}

@Injectable()
export class ProductAgent {
  private readonly logger = new Logger(ProductAgent.name);
  private readonly client: Anthropic;

  constructor(private readonly products: ProductsService) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async findBestProducts(
    userId: string,
    keywords: string[],
    filters: { category_id?: string; min_price?: number; max_price?: number; min_discount?: number },
    count = 3,
  ): Promise<{ products: RankedProduct[]; tokens: number }> {
    const tools: Anthropic.Tool[] = [
      {
        name: 'search_products',
        description: 'Search AliExpress for products matching a keyword and filters. Returns a list of products with prices, ratings, and order counts.',
        input_schema: {
          type: 'object' as const,
          properties: {
            keyword: { type: 'string', description: 'Search keyword' },
            category_id: { type: 'string', description: 'AliExpress category ID (optional)' },
            min_price: { type: 'number', description: 'Minimum price filter (optional)' },
            max_price: { type: 'number', description: 'Maximum price filter (optional)' },
            min_discount: { type: 'number', description: 'Minimum discount percent (optional)' },
            limit: { type: 'number', description: 'Max results to return (default 10)' },
          },
          required: ['keyword'],
        },
      },
    ];

    const systemPrompt = `You are a product discovery agent for an affiliate marketing platform. The platform earns commission on every sale, so commission rate is the PRIMARY profitability driver — prioritize it alongside conversion signals.
Your task: find the best-converting, highest-commission products from AliExpress for Telegram channel posts.
Ranking criteria: high commission_rate (most important — this is the platform's revenue), high discount_percent, high orders_count, good rating (>4.0), reasonable price.
Score = (commission_rate * 3) + (discount_percent * 0.3) + (min(orders_count, 10000) / 10000 * 30) + (rating / 5 * 15).
Treat products with commission_rate of 0 or missing as lower priority than otherwise-similar products with a known commission rate — prefer ones where commission data is available.
After searching, select the top ${count} products by score and return them as JSON.`;

    const keywordsText = keywords.slice(0, 3).join(', ');
    const filtersText = JSON.stringify(filters);

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Find the top ${count} best-converting, highest-commission products for these keywords: "${keywordsText}".
Filters: ${filtersText}.
Search for 1-2 keywords, rank all results by score (commission rate weighted heaviest), return the top ${count} as JSON array.
Format: [{ product_id, title, sale_price, original_price, discount_percent, orders_count, rating, image_url, category, currency, commission_rate, score }]`,
      },
    ];

    let totalTokens = 0;
    let rankedProducts: RankedProduct[] = [];
    let iterCount = 0;

    while (iterCount < 5) {
      iterCount++;
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages,
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      if (response.stop_reason === 'tool_use') {
        const assistantMessage: Anthropic.MessageParam = { role: 'assistant', content: response.content };
        messages.push(assistantMessage);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          if (block.name !== 'search_products') continue;

          const input = block.input as any;
          try {
            const result = await this.products.search(userId, {
              keyword: input.keyword,
              category_id: filters.category_id || input.category_id,
              min_price: filters.min_price ?? input.min_price,
              max_price: filters.max_price ?? input.max_price,
              min_discount: filters.min_discount ?? input.min_discount,
              limit: Math.min(input.limit || 10, 20),
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result.data),
            });
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message }),
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // end_turn — extract JSON from final text block
      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        const match = textBlock.text.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            rankedProducts = JSON.parse(match[0]);
          } catch {
            this.logger.warn('ProductAgent: failed to parse JSON from response');
          }
        }
      }
      break;
    }

    return { products: rankedProducts.slice(0, count), tokens: totalTokens };
  }
}
