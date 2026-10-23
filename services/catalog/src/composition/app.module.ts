import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CATALOG_ENTITIES } from "../infrastructure/persistence/entities";
import { CAPABILITY_SOURCE, HealthController } from "../presentation/health.controller";
import { ReadinessService } from "../application/readiness";
import { loadEnv } from "../infrastructure/config/env";
import { createProbes } from "../infrastructure/probes/create-probes";
import { buildCapabilities } from "../infrastructure/probes/capability-factory";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv(process.env);
        return {
          type: "postgres" as const,
          url: env.databaseUrl,
          synchronize: false,
          migrationsRun: false,
          entities: CATALOG_ENTITIES,
          autoLoadEntities: false,
          retryAttempts: 10,
          retryDelay: 3000,
          logging: false,
        };
      },
    }),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: ReadinessService,
      useFactory: () => {
        const env = loadEnv(process.env);
        return new ReadinessService(env.serviceName, createProbes(env));
      },
    },
    {
      provide: CAPABILITY_SOURCE,
      useFactory: () => ({ current: () => buildCapabilities(loadEnv(process.env)) }),
    },
  ],
})
export class AppModule {}
