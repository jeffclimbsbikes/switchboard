import subprocess, json, sys, time
prompt, extra = sys.argv[1], sys.argv[2:]
p = subprocess.Popen(["claude","-p","--input-format","stream-json","--output-format","stream-json","--verbose","--model","haiku","--setting-sources","","--strict-mcp-config","--permission-prompt-tool","stdio"]+extra,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
send=lambda o:(p.stdin.write(json.dumps(o)+"\n"),p.stdin.flush())
send({"type":"user","message":{"role":"user","content":prompt}})
for l in p.stdout:
    d=json.loads(l); t=d["type"]
    if t=="control_request":
        print("CONTROL_REQUEST",json.dumps(d)[:1500])
        r=d["request"]
        if r["subtype"]=="can_use_tool":
            if r["tool_name"]=="AskUserQuestion":
                qs=r["input"]["questions"]
                ans={qs[0]["question"]:qs[0]["options"][0]["label"]}
                resp={"behavior":"allow","updatedInput":{**r["input"],"answers":ans}}
            else:
                resp={"behavior":"allow","updatedInput":r["input"]}
            send({"type":"control_response","response":{"subtype":"success","request_id":d["request_id"],"response":resp}})
    elif t=="assistant": print("A",json.dumps([c for c in d["message"]["content"] if c["type"]!="thinking"])[:300])
    elif t=="user": print("U",json.dumps(d["message"]["content"])[:300])
    elif t=="result": print("R",d["result"][:200],d["permission_denials"]); break
    else: print(t,d.get("subtype",""))
p.stdin.close(); p.wait(timeout=10)
