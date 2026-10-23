from datetime import datetime


AFFIRMATIONS = {"si", "sí", "yes", "ok", "confirmo", "confirmar", "adelante", "hazlo", "ya confirme", "ya confirmé"}


def is_textual_confirmation(text: str) -> bool:
    normalized = " ".join(text.strip().lower().split())
    return normalized in AFFIRMATIONS


def rejection_reason(status: str, expires_at: str, now: str, session_active: bool) -> str | None:
    if not session_active:
        return "session_revoked"
    if status != "pending":
        return "not_pending"
    expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    current = datetime.fromisoformat(now.replace("Z", "+00:00"))
    if expiry <= current:
        return "expired"
    return None


def card_from_proposal(proposal: dict) -> dict:
    required = ("id", "status", "amount", "currency", "expiresAt", "sourceAccountId", "destinationLabel", "concept")
    if any(key not in proposal for key in required):
        raise ValueError("invalid_proposal")
    if proposal["currency"] != "MXN":
        raise ValueError("invalid_proposal")
    return {
        "proposalId": proposal["id"],
        "status": proposal["status"],
        "amount": proposal["amount"],
        "currency": "MXN",
        "expiresAt": proposal["expiresAt"],
        "sourceAccountId": proposal["sourceAccountId"],
        "destinationLabel": proposal["destinationLabel"],
        "concept": proposal["concept"],
    }
