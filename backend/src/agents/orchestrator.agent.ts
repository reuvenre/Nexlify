import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductAgent } from './product.agent';
import { ContentAgent } from './content.agent';
import { CampaignAgent } from './campaign.agent';
import { AgentRun } from './agent-run.entity';
import { PostsService } from '../posts/posts.service';
import { RatesService } from '../rates/rates.service';
import { CredentialsService } from '../credentials/credentials.service';
import { Campaign } from '../campaigns/campaign.entity';

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪', EUR: '€', GBP: '£', USD: '$',
};

export interface OrchestratorResult {
  run_id: string;
  posts_created: number;
  products_found: number;
  campaign_health: string;
  tokens_used: number;
  errors: string[];
}

@Injectable()
export class OrchestratorAgent {
  private readonly logger = new Logger(OrchestratorAgent.name);

  constructor(
    private readonly productAgent: ProductAgent,
    private readonly contentAgent: ContentAgent,
    private readonly campaignAgent: CampaignAgent,
    private readonly posts: PostsService,
    private readonly rates: RatesService,
    private readonly credentials: CredentialsService,
    @InjectRepository(AgentRun)
    private readonly runRepo: Repository<AgentRun>,
  ) {}

  async run(campaign: Campaign, userId: string): Promise<OrchestratorResult> {
    const run = this.runRepo.create({
      user_id: userId,
      campaign_id: campaign.id,
      agent_type: 'orchestrator',
      input: { campaign_id: campaign.id, campaign_name: campaign.name },
      status: 'running',
    });
    await this.runRepo.save(run);

    const errors: string[] = [];
    let postsCreated = 0;
    let totalTokens = 0;

    try {
      const creds = await this.credentials.getRaw(userId);
      if (!creds) throw new Error('No credentials found for user');

      const currencyPair = creds.currency_pair || 'USD_ILS';
      const targetCurrency = currencyPair.split('_')[1] || 'ILS';
      const currencySymbol = CURRENCY_SYMBOLS[targetCurrency] || '₪';
      const rate = await this.rates.getRate(currencyPair);

      // 1. Product Agent — find best products
      this.logger.log(`[Orchestrator] Finding products for campaign "${campaign.name}"`);
      const { products, tokens: productTokens } = await this.productAgent.findBestProducts(
        userId,
        campaign.keywords,
        {
          category_id: campaign.category_id,
          min_price: campaign.min_price,
          max_price: campaign.max_price,
          min_discount: campaign.min_discount,
        },
        campaign.posts_per_run,
      );
      totalTokens += productTokens;
      this.logger.log(`[Orchestrator] Found ${products.length} products`);

      // 2. Content Agent + Post creation — for each product
      for (const product of products) {
        try {
          this.logger.log(`[Orchestrator] Generating content for "${product.title}"`);
          const { text, tokens: contentTokens } = await this.contentAgent.generateOptimizedContent(
            userId,
            campaign.id,
            product,
            campaign.language || 'he',
            rate,
            currencySymbol,
            campaign.post_template,
            creds,
          );
          totalTokens += contentTokens;

          if (!text) {
            errors.push(`Empty content for product ${product.product_id}`);
            continue;
          }

          // Create and send the post using PostsService
          await this.posts.createAgentPost(userId, campaign.id, {
            product_id: product.product_id,
            title: product.title,
            image_url: product.image_url,
            sale_price: product.sale_price,
            original_price: product.original_price,
            currency: product.currency,
            generated_text: text,
            rate,
          }, creds);

          postsCreated++;

          // Small delay between posts to avoid Telegram rate limits
          await new Promise((r) => setTimeout(r, 1500));
        } catch (err: any) {
          errors.push(`Product ${product.product_id}: ${err.message}`);
          this.logger.error(`[Orchestrator] Post creation failed: ${err.message}`);
        }
      }

      // 3. Campaign Agent — evaluate health after run
      this.logger.log(`[Orchestrator] Evaluating campaign health`);
      const health = await this.campaignAgent.evaluateAndOptimize(userId, campaign.id);
      totalTokens += health.tokens;

      const result: OrchestratorResult = {
        run_id: run.id,
        posts_created: postsCreated,
        products_found: products.length,
        campaign_health: health.status,
        tokens_used: totalTokens,
        errors,
      };

      run.status = 'completed';
      run.output = { ...result, campaign_health_detail: health };
      run.tokens_used = totalTokens;
      await this.runRepo.save(run);

      return result;
    } catch (err: any) {
      this.logger.error(`[Orchestrator] Run failed: ${err.message}`);
      run.status = 'failed';
      run.error_message = err.message;
      run.tokens_used = totalTokens;
      await this.runRepo.save(run);

      return {
        run_id: run.id,
        posts_created: postsCreated,
        products_found: 0,
        campaign_health: 'degraded',
        tokens_used: totalTokens,
        errors: [err.message, ...errors],
      };
    }
  }
}
