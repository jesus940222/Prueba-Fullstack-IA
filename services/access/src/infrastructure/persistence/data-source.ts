import { DataSource } from "typeorm";
import { AccessSchema1732000000000 } from "./schema.migration";
import { Baseline1730000000000 } from "./baseline.migration";

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    synchronize: false,
    migrationsRun: false,
    migrations: [Baseline1730000000000, AccessSchema1732000000000],
    logging: false,
  });
}
