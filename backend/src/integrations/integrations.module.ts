import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsBridgeController } from './integrations-bridge.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  controllers: [IntegrationsController, IntegrationsBridgeController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
