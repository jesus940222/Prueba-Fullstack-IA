from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import GraphInterrupt
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from portal_ai.domain.redaction import redact


class GraphState(TypedDict):
    run_id: str
    done: bool


class RedactingSaver(InMemorySaver):
    def __init__(self):
        super().__init__()
        self.audited: list = []

    def put(self, config, checkpoint, metadata, new_versions):
        copied = dict(checkpoint)
        copied["channel_values"] = redact(dict(checkpoint.get("channel_values") or {}))
        cleaned_metadata = redact(dict(metadata)) if isinstance(metadata, dict) else metadata
        self.audited.append(redact(copied))
        return super().put(config, copied, cleaned_metadata, new_versions)


def build_graph(engine, saver):
    def step(state: GraphState) -> GraphState:
        outcome = engine.step(state["run_id"])
        if outcome == "pause":
            interrupt({"proposalId": engine.store.runs[state["run_id"]].get("proposal_id"), "executeTransfer": False})
            engine.finish_card(state["run_id"])
            return {"run_id": state["run_id"], "done": True}
        return {"run_id": state["run_id"], "done": outcome != "continue"}

    graph = StateGraph(GraphState)
    graph.add_node("step", step)
    graph.add_edge(START, "step")
    graph.add_conditional_edges("step", lambda state: END if state["done"] else "step")
    return graph.compile(checkpointer=saver)


def execute_graph(graph, run_id: str) -> None:
    config = {"configurable": {"thread_id": run_id}}
    try:
        graph.invoke({"run_id": run_id, "done": False}, config)
    except GraphInterrupt:
        graph.invoke(Command(resume={"executeTransfer": False}), config)
