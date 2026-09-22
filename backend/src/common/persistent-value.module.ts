import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersistentValue } from './persistent-value.entity';
import { PersistentValueStore } from './persistent-value.store';

/**
 * Global, like the `CacheModule` it stands in for.
 *
 * This is infrastructure, not a feature: it is the answer to "where does a value live when
 * the process will not". Any module that was reaching for the cache with a long TTL should
 * be able to reach for this instead without a wiring change, which is exactly what keeps the
 * two from drifting into separate copies of the same idea.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PersistentValue])],
  providers: [PersistentValueStore],
  exports: [PersistentValueStore],
})
export class PersistentValueModule {}
