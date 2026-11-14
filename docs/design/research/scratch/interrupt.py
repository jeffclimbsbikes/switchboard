import subprocess, json
p=subprocess.Popen(["claude","-p","--input-format","stream-json","--output-format","stream-json","--verbose","--include-partial-messages","--model","haiku","--setting-sources","","--strict-mcp-config","--tools",""],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
send=lambda o:(p.stdin.write(json.dumps(o)+"\n"),p.stdin.flush())
send({"type":"user","message":{"role":"user","content":"count from 1 to 300, one number per line"}})
n=0;sent=False
for l in p.stdout:
    d=json.loads(l);t=d["type"]
    if t=="stream_event":
        n+=1
        if n==1: print("sample stream_event:",l[:300])
        if n==8 and not sent:
            send({"type":"control_request","request_id":"int1","request":{"subtype":"interrupt"}});sent=True
    elif t=="control_response": print("CTRL_RESP",l[:200])
    elif t=="result": print("RESULT",{k:d[k] for k in("subtype","is_error","terminal_reason","stop_reason") if k in d},d.get("result","")[:40]);break
    else: print(t,d.get("subtype",""))
# process stays alive; send next turn
send({"type":"user","message":{"role":"user","content":"say ok"}})
for l in p.stdout:
    d=json.loads(l)
    if d["type"]=="result": print("NEXT TURN",d["result"]);break
p.stdin.close();p.wait(timeout=10)
