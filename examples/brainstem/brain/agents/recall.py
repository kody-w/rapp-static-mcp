import json
META = {"id":"recall","name":"Recall","when_to_use":"remember recall or look up something from memory","inputs":{"query":"string","memory":"array"}}
def perform(input):
    d = input or {}
    q = str(d.get("query") or d.get("message") or "").lower()
    mem = d.get("memory") or []
    hits = [m for m in mem if q in json.dumps(m).lower()][:8]
    txt = ("Recalled %d: " % len(hits)) + " | ".join(h.get("text", json.dumps(h)) for h in hits) if hits else ('Nothing in memory matches "%s".' % q)
    return {"query": q, "hits": hits, "text": txt, "agent": "recall"}
