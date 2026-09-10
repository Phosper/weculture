import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminGuard, UserGuard } from './auth';
import { ENTITIES } from './entities';

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', location: 'weculture.sqlite', autoSave: true, entities: ENTITIES, synchronize: true }), TypeOrmModule.forFeature(ENTITIES)],
  controllers: [AppController],
  providers: [AppService, UserGuard, AdminGuard],
})
export class AppModule {}
