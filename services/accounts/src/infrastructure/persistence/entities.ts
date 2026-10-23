import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "customers" })
export class CustomerEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ name: "customer_number" })
  customerNumber!: string;

  @Column({ name: "given_name" })
  givenName!: string;

  @Column({ name: "family_name" })
  familyName!: string;

  @Column()
  status!: string;
}

@Entity({ name: "accounts" })
export class AccountEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "customer_id" })
  customerId!: string;

  @Column({ name: "account_number" })
  accountNumber!: string;

  @Column()
  name!: string;

  @Column()
  currency!: string;

  @Column()
  status!: string;

  @Column({ type: "numeric", precision: 18, scale: 2 })
  balance!: string;
}

@Entity({ name: "movements" })
export class MovementEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "account_id" })
  accountId!: string;

  @Column("uuid", { name: "transfer_id", nullable: true })
  transferId!: string | null;

  @Column()
  type!: string;

  @Column()
  direction!: string;

  @Column({ type: "numeric", precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: "numeric", precision: 18, scale: 2, name: "balance_after" })
  balanceAfter!: string;
}

@Entity({ name: "transfer_proposals" })
export class ProposalEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "user_id" })
  userId!: string;

  @Column("uuid", { name: "session_id" })
  sessionId!: string;

  @Column({ type: "numeric", precision: 18, scale: 2 })
  amount!: string;

  @Column()
  status!: string;
}

@Entity({ name: "transfers" })
export class TransferEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column()
  reference!: string;

  @Column("uuid", { name: "proposal_id" })
  proposalId!: string;

  @Column({ type: "numeric", precision: 18, scale: 2 })
  amount!: string;

  @Column()
  status!: string;
}

@Entity({ name: "beneficiaries" })
export class BeneficiaryEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "customer_id" })
  customerId!: string;

  @Column("uuid", { name: "destination_account_id" })
  destinationAccountId!: string;

  @Column()
  alias!: string;

  @Column()
  status!: string;
}
