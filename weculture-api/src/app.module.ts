import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminGuard, UserGuard } from './auth';
import { ENTITIES } from './entities';
import { createDatabaseOptions } from './database';
import { CityLocationController, CityLocationService } from './city-location';

@Module({
  imports: [TypeOrmModule.forRoot(createDatabaseOptions()), TypeOrmModule.forFeature(ENTITIES)],
  controllers: [AppController, CityLocationController],
  providers: [AppService, CityLocationService, UserGuard, AdminGuard],
})
export class AppModule {}
