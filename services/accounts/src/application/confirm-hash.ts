import { createHash } from "node:crypto";
import type { ProposalRecord } from "../domain/records";

export function confirmRequestHash(proposal: Pick<ProposalRecord, "id" | "sourceAccountId" | "destinationAccountId" | "amount" | "currency" | "concept">): string {
  const canonical = [proposal.id, proposal.sourceAccountId, proposal.destinationAccountId, proposal.amount, proposal.currency, proposal.concept].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
