// 挂机中控服务端 - Deno Deploy
const TOKEN = "lblt_2026_kz_9a3f";

const kv = await Deno.openKv();

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers });

  if (url.searchParams.get("token") !== TOKEN) {
    return json({ ok: false, error: "invalid token" }, 401, headers);
  }

  try {
    // ===== 同步：上报状态 + 拉指令 =====
    if (path === "/sync" && request.method === "GET") {
      const clientId = url.searchParams.get("client") || "1";
      const doWrite = url.searchParams.get("write") !== "0";

      if (doWrite) {
        await kv.set([`client_${clientId}`], JSON.stringify({
          status: parseInt(url.searchParams.get("status") || "0") || 0,
          task: url.searchParams.get("task") || "",
          progress: url.searchParams.get("progress") || "0%",
          error: url.searchParams.get("error") || "",
          ver: url.searchParams.get("ver") || "未知",
          heartbeat: Date.now(),
        }));
      }

      let cmd = { cmd: "", task: "" };
      const cmdRes = await kv.get([`cmd_${clientId}`]);
      if (cmdRes.value) {
        const parsed = JSON.parse(cmdRes.value as string);
        if (Date.now() - parsed.time < 300000) cmd = parsed;
        await kv.delete([`cmd_${clientId}`]);
      }

      return json({ ok: true, cmd: cmd.cmd || "", task: cmd.task || "" }, 200, headers);
    }

    // ===== 查看所有客户端状态 =====
    if (path === "/list" && request.method === "GET") {
      const now = Date.now();
      const iter = kv.list({ prefix: ["client_"] });
      const results = [];
      for await (const entry of iter) {
        const id = (entry.key[0] as string).replace("client_", "");
        const data = JSON.parse(entry.value as string);
        data.online = now - data.heartbeat < 60000;
        data.id = id;
        results.push(data);
      }
      results.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      return json(results, 200, headers);
    }

    // ===== 给单个客户端下发指令 =====
    if (path === "/send" && request.method === "GET") {
      const clientId = url.searchParams.get("client") || "1";
      await kv.set([`cmd_${clientId}`], JSON.stringify({
        cmd: url.searchParams.get("cmd") || "",
        task: url.searchParams.get("task") || "",
        time: Date.now(),
      }));
      return json({ ok: true }, 200, headers);
    }

    // ===== 给所有客户端批量下发 =====
    if (path === "/sendall" && request.method === "GET") {
      const cmd = {
        cmd: url.searchParams.get("cmd") || "",
        task: url.searchParams.get("task") || "",
        time: Date.now(),
      };
      const iter = kv.list({ prefix: ["client_"] });
      const ops = [];
      for await (const entry of iter) {
        const id = (entry.key[0] as string).replace("client_", "");
        ops.push(kv.set([`cmd_${id}`], JSON.stringify(cmd)));
      }
      await Promise.all(ops);
      return json({ ok: true, count: ops.length }, 200, headers);
    }

    // ===== 根路径 =====
    return json({ msg: "中控服务端运行中" }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500, headers);
  }
});

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
