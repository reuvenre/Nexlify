import { Module } from '@nestjs/common';
import { CollageService } from './collage.service';

@Module({
  providers: [CollageService],
  exports: [CollageService],
})
export class CollageModule {}
