import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { AdminController } from './admin.controller';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), SubscriptionModule],
  providers: [UsersService],
  controllers: [AdminController],
  exports: [UsersService],
})
export class UsersModule {}
