import { DataSource } from "typeorm";
import { Baseline1730000000000 } from "./baseline.migration";
import { CATALOG_ENTITIES } from "./entities";
import { CatalogSchema1732200000000 } from "./schema.migration";

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    synchronize: false,
    migrationsRun: false,
    entities: CATALOG_ENTITIES,
    migrations: [Baseline1730000000000, CatalogSchema1732200000000],
    logging: false,
  });
}
