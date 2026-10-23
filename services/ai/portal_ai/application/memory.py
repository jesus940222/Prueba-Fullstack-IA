import threading
from dataclasses import dataclass, field


@dataclass
class MemoryStore:
    conversations: dict = field(default_factory=dict)
    messages: list = field(default_factory=list)
    runs: dict = field(default_factory=dict)
    events: dict = field(default_factory=dict)
    effects: dict = field(default_factory=dict)
    samples: list = field(default_factory=list)
    documents: dict = field(default_factory=dict)
    jobs: dict = field(default_factory=dict)
    rules: dict = field(default_factory=dict)
    alerts: list = field(default_factory=list)
    deliveries: list = field(default_factory=list)
    outbox: list = field(default_factory=list)
    reservations: list = field(default_factory=list)
    spent: list = field(default_factory=list)
    rate_stamps: dict = field(default_factory=dict)
    vectors: list = field(default_factory=list)
    sessions: dict = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add_event(self, run_id: str, event: dict) -> dict:
        bucket = self.events.setdefault(run_id, [])
        stored = {"id": len(bucket) + 1, **event}
        bucket.append(stored)
        return stored

    def once(self, key: str, value: dict) -> dict:
        with self.lock:
            current = self.effects.get(key)
            if current is not None:
                return current
            self.effects[key] = value
            return value
