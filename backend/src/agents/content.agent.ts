import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { Post } from '../posts/post.entity';
import { AiService } from '../ai/ai.service';
import { DecryptedCredentials } from '../credentials/credentials.service';
import { AgentClient } from './agent-client.service';
import { anthropicInputTokens, EPHEMERAL } from '../ai/anthropic-cache';
import { UNTRUSTED_DATA_RULE, fenceUntrusted, stripFenceMarks } from '../common/untrusted';

export interface GeneratedContent {
  text: string;
  language: string;
  tokens: number;
}

@Injectable()
export class ContentAgent {
  private readonly logger = new Logger(ContentAgent.name);

  constructor(
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    private readonly ai: AiService,
    private readonly agentClient: AgentClient,
  ) {}

  async generateOptimizedContent(
    userId: string,
    campaignId: string,
    product: {
      product_id: string;
      title: string;
      sale_price: number;
      original_price: number;
      discount_percent: number;
      orders_count: number;
      rating: number;
      category: string;
      currency: string;
    },
    language: string,
    exchangeRate: number,
    currencySymbol: string,
    template?: string,
    creds?: DecryptedCredentials | null,
    /** One line of commercial-calendar context ("it is the Tishrei holiday season…"),
     *  or null outside every window. Appended to the system prompt exactly as the plain
     *  runner does it — the agents path used to receive nothing, so an agents campaign
     *  wrote holiday-blind copy all through the holidays. */
    seasonHint?: string | null,
  ): Promise<GeneratedContent> {
    const tools: Anthropic.Tool[] = [
      {
        name: 'get_recent_posts',
        description: 'Get recent successful posts for this user to learn style and patterns that work well.',
        input_schema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Number of recent posts to retrieve (max 10)' },
          },
          required: [],
        },
      },
    ];

    const priceLocal = (product.sale_price * exchangeRate).toFixed(0);
    const originalLocal = (product.original_price * exchangeRate).toFixed(0);
    const discount = product.discount_percent || Math.round((1 - product.sale_price / product.original_price) * 100);
    const orders = product.orders_count >= 1000
      ? `${(product.orders_count / 1000).toFixed(1)}K+`
      : `${product.orders_count}`;

    let systemPrompt = buildSystemPrompt(language, template);
    // Same placement the plain runner uses, so a product published through either path
    // reads the same during a holiday window.
    if (seasonHint) systemPrompt += `\n\n${seasonHint}`;
    // Titles and categories below (and in get_recent_posts) are the seller's words.
    systemPrompt += `\n\n${UNTRUSTED_DATA_RULE}`;

    const productBrief = `Product details:
- Name: ${fenceUntrusted(product.title)}
- Sale price: ${currencySymbol}${priceLocal} (was ${currencySymbol}${originalLocal})
- Discount: ${discount}%
- Orders: ${orders} customers bought
- Rating: ${product.rating?.toFixed(1) || 'N/A'}/5
- Category: ${fenceUntrusted(product.category) || 'General'}

Requirements:
- Language: ${language === 'he' ? 'Hebrew only' : language === 'ar' ? 'Arabic only' : 'English only'}
- Use HTML: <b> for prices/headlines, <i> for subtle emphasis
- Length: 80–130 words
- Do NOT include a URL/link (it will be appended automatically)
- Include FOMO and strong call-to-action`;

    // Multi-provider: when the user selected OpenAI/Gemini, generate via the unified
    // engine. The recent-posts learning tool is Anthropic-only, so it's skipped for
    // other providers (the campaign still gets fully written copy).
    const provider = this.ai.resolveProvider(creds ?? null);
    if (creds && provider && provider !== 'anthropic') {
      const r = await this.ai.generate(creds, {
        system: systemPrompt,
        prompt: `Write an optimized Telegram marketing post for this product.\n\n${productBrief}`,
        maxTokens: 1024,
        temperature: 0.85,
      });
      // Fall back to a deterministic post so the campaign stays populated even
      // if the provider call fails or returns empty.
      const text = stripFenceMarks(r?.text?.trim() || '')
        || fallbackPost(language, product.title, currencySymbol, priceLocal, originalLocal, discount);
      return { text, language, tokens: r?.tokens || 0 };
    }

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `First, check recent successful posts to understand what style resonates with this audience.
Then write an optimized Telegram marketing post for this product.

${productBrief}`,
      },
    ];

    let totalTokens = 0;
    let generatedText = '';
    let iterCount = 0;
    const { client, model } = await this.agentClient.for(userId);

    while (iterCount < 4) {
      iterCount++;
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
        // Each turn re-sends the whole loop so far; this breakpoint moves with it, so the
        // next turn reads it from cache (anthropic-cache.ts).
        cache_control: EPHEMERAL,
      });

      totalTokens += anthropicInputTokens(response.usage) + response.usage.output_tokens;
      this.agentClient.record(userId, response.usage);

      if (response.stop_reason === 'tool_use') {
        const assistantMessage: Anthropic.MessageParam = { role: 'assistant', content: response.content };
        messages.push(assistantMessage);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          if (block.name !== 'get_recent_posts') continue;

          const limit = Math.min((block.input as any).limit || 5, 10);
          try {
            const posts = await this.postRepo
              .createQueryBuilder('p')
              .where('p.user_id = :userId AND p.status = :status', { userId, status: 'sent' })
              .orderBy('p.sent_at', 'DESC')
              .take(limit)
              .getMany();

            const samples = posts.map((p) => ({
              title: fenceUntrusted(p.product_title),
              text_preview: p.generated_text?.substring(0, 200),
              sent_at: p.sent_at,
            }));

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(samples),
            });
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message, samples: [] }),
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // end_turn — extract the generated post text
      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        generatedText = stripFenceMarks(textBlock.text.trim());
      }
      break;
    }

    return { text: generatedText, language, tokens: totalTokens };
  }
}

/** Deterministic post used when an AI provider returns nothing. */
function fallbackPost(
  language: string, title: string, symbol: string,
  priceLocal: string, originalLocal: string, discount: number,
): string {
  if (language === 'ar') {
    return `<b>${title}</b>\n\n💸 <b>${symbol}${priceLocal}</b> بدلاً من ${symbol}${originalLocal} (−${discount}%)\n\n👇 للتفاصيل والشراء`;
  }
  if (language === 'en') {
    return `<b>${title}</b>\n\n💸 <b>${symbol}${priceLocal}</b> instead of ${symbol}${originalLocal} (−${discount}%)\n\n👇 Tap for details`;
  }
  return `<b>${title}</b>\n\n💸 <b>${symbol}${priceLocal}</b> במקום ${symbol}${originalLocal} (−${discount}%)\n\n👇 לפרטים ולרכישה`;
}

function buildSystemPrompt(language: string, template?: string): string {
  const templateNote = template
    ? `\n\nUse this template as a structural guide (adapt it to the product):\n${template}`
    : '';

  if (language === 'he') {
    return `אתה קופירייטר מומחה לערוצי Telegram בעברית המתמחה בשיווק שותפים AliExpress.
תפקידך: לכתוב פוסטים שמוכרים — לא רק מציגים מוצר.

כללים קריטיים:
• כתוב בעברית בלבד (שמות מוצרים מותר להשאיר כפי שהם)
• אל תכלול קישור — הוא יצורף אוטומטית
• מבנה: פתיחה מושכת → ערך המוצר → מחיר ממוחק + נוכחי → ביצועים → קריאה לפעולה
• HTML: <b>...</b> לכותרות/מחירים, <i>...</i> לדגש
• אורך: 80–130 מילים
• סגנון: נרגש אבל אמין, כמו חבר שממליץ על דיל
• כלול FOMO עדין (מלאי מוגבל / מחיר זמני)${templateNote}`;
  }
  if (language === 'ar') {
    return `أنت كاتب إعلانات متخصص في قنوات Telegram العربية لتسويق AliExpress بالعمولة.
مهمتك: كتابة منشورات تبيع — ليس مجرد عرض منتج.

قواعد:
• اكتب باللغة العربية فقط
• لا تضمّن رابطاً — سيُضاف تلقائياً
• هيكل: فتح جذاب → قيمة → السعر القديم + الجديد → أداء → دعوة للعمل
• HTML: <b>للأسعار والعناوين</b>
• الطول: 80–130 كلمة
• الأسلوب: متحمس لكن موثوق${templateNote}`;
  }
  return `You are an expert Telegram affiliate copywriter for AliExpress products.
Your job: write posts that SELL — not just describe.

Rules:
• English only
• Do NOT include a URL — it will be appended
• Structure: hook → product value → crossed-out price + sale price → social proof → strong CTA
• HTML: <b>for prices/headlines</b>, <i>for subtle emphasis</i>
• Length: 80–130 words
• Style: excited but credible, like a friend recommending a real deal
• Include subtle FOMO${templateNote}`;
}
