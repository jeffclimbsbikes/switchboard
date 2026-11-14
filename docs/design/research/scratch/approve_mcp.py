import sys, json
for l in sys.stdin:
    m=json.loads(l); i=m.get("id"); me=m.get("method")
    if me=="initialize": r={"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"appr","version":"0"}}
    elif me=="tools/list": r={"tools":[{"name":"approve","description":"approve","inputSchema":{"type":"object","properties":{"tool_name":{"type":"string"},"input":{"type":"object"},"tool_use_id":{"type":"string"}}}}]}
    elif me=="tools/call":
        a=m["params"]["arguments"]; open("/tmp/cc1/mcp_args.json","w").write(json.dumps(a))
        r={"content":[{"type":"text","text":json.dumps({"behavior":"allow","updatedInput":a.get("input",{})})}]}
    else:
        if i is None: continue
        r={}
    print(json.dumps({"jsonrpc":"2.0","id":i,"result":r}),flush=True)
