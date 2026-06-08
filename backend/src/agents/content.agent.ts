import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { Post } from '../posts/post.entity';

export interface GeneratedContent {
  text: string;
  language: string;
  tokens: number;
}

@Injectable()
export class ContentAgent {
  private readonly logger = new Logger(ContentAgent.name);
  private readonly client: Anthropic;

  constructor(
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
  ) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

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
  ): Promise<GeneratedContent> {
    const tools: Anthropic.Tool[] = [
      {
        name: 'get_recent_posts',
        description: 'Get recent successful posts for this user — including each post\'s opening line — to learn style/patterns that work AND to avoid repeating the same hooks.',
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

    const systemPrompt = buildSystemPrompt(language, template);

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `First, check recent successful posts — note their opening_line values so you can write a FRESH hook that doesn't repeat them.
Then write an optimized Telegram marketing post for this product.

Product details:
- Name: ${product.title}
- Sale price: ${currencySymbol}${priceLocal} (was ${currencySymbol}${originalLocal})
- Discount: ${discount}%
- Orders: ${orders} customers bought
- Rating: ${product.rating?.toFixed(1) || 'N/A'}/5
- Category: ${product.category || 'General'}

Requirements:
- Language: ${language === 'he' ? 'Hebrew only' : language === 'ar' ? 'Arabic only' : 'English only'}
- Use HTML: <b> for prices/headlines, <i> for subtle emphasis
- Length: 80–130 words
- Do NOT include a URL/link (it will be appended automatically)
- Include FOMO and strong call-to-action
- Open with a hook that is clearly DIFFERENT from the opening_line values of the recent posts you reviewed — vary the angle (price shock, use-case, social proof, urgency, curiosity) so the channel doesn't feel repetitive`,
      },
    ];

    let totalTokens = 0;
    let generatedText = '';
    let iterCount = 0;

    while (iterCount < 4) {
      iterCount++;
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
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
              title: p.product_title,
              opening_line: p.generated_text?.split(/[\n.!?]/)[0]?.replace(/<[^>]+>/g, '').trim().substring(0, 80),
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
        generatedText = textBlock.text.trim();
      }
      break;
    }

    return { text: generatedText, language, tokens: totalTokens };
  }
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
