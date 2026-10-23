import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { CAPABILITY_SOURCE, HealthController } from "../presentation/health.controller";
import { ReadinessService } from "../application/readiness";
import { loadEnv } from "../infrastructure/config/env";
import { createProbes } from "../infrastructure/probes/create-probes";
import { buildCapabilities } from "../infrastructure/probes/capability-factory";

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv(process.env);
        return { uri: env.databaseUrl, serverSelectionTimeoutMS: 5000 };
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
