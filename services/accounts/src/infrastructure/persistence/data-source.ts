import { DataSource } from "typeorm";
import { Baseline1730000000000 } from "./baseline.migration";
import { AccountEntity, BeneficiaryEntity, CustomerEntity, MovementEntity, ProposalEntity, TransferEntity } from "./entities";
import { AccountsSchema1732100000000 } from "./schema.migration";

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    synchronize: false,
    migrationsRun: false,
    entities: [CustomerEntity, AccountEntity, MovementEntity, ProposalEntity, TransferEntity, BeneficiaryEntity],
    migrations: [Baseline1730000000000, AccountsSchema1732100000000],
    logging: false,
  });
}
