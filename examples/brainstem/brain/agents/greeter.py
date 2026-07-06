META = {"id":"greeter","name":"Greeter","when_to_use":"greet welcome or introduce someone","inputs":{"name":"string"}}
def perform(input):
    d = input or {}
    name = d.get("name") or d.get("message") or "friend"
    return {"text": f"Hello, {name} — the brainstem routed you to the Greeter agent.", "agent": "greeter"}
