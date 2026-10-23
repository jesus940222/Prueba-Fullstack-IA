from portal_ai.application.engine import ConversationEngine


def drive(engine: ConversationEngine, run_id: str) -> None:
    while True:
        outcome = engine.step(run_id)
        if outcome == "pause":
            engine.finish_card(run_id)
            return
        if outcome != "continue":
            return
