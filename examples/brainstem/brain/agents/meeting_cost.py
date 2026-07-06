import re
META = {"id":"meeting-cost","name":"Meeting Cost","when_to_use":"estimate the cost or price of a meeting","inputs":{"people":"number","minutes":"number","rate":"number"}}
def _num(msg, pat, dflt):
    m = re.search(pat, msg or "", re.I)
    return float(m.group(1)) if m else dflt
def perform(input):
    d = input or {}; msg = d.get("message","")
    p = float(d.get("people") or _num(msg, r"(\d+)\s*(?:people|person|attendees)", 6))
    mins = float(d.get("minutes") or _num(msg, r"(\d+)\s*(?:min|minutes)", 30))
    rate = float(d.get("rate") or _num(msg, r"\$?(\d+)\s*/?\s*(?:h|hr|hour)", 75))
    cost = round(p * (mins/60.0) * rate, 2)
    return {"people":p,"minutes":mins,"hourly_rate":rate,"cost":cost,
            "text": f"{int(p)} people x {int(mins)} min x ${int(rate)}/h = ${cost:.2f}", "agent":"meeting-cost"}
