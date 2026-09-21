// 挂机中控服务端 - Deno Deploy 最终版
const TOKEN = "lblt_2026_kz_9a3f";

const kv = await Deno.openKv();

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (method === "OPTIONS") return new Response(null, { headers });

  if (url.searchParams.get("token") !== TOKEN) {
    return json({ ok: false, error: "invalid token" }, 401, headers);
  }

  try {
    // ===== 同步接口：上报状态 + 拉指令 =====
    if (path === "/sync" && method === "GET") {
      const clientId = url.searchParams.get("client") || "1";
      const doWrite = url.searchParams.get("write") !== "0";

      if (doWrite) {
        const data = {
          status: parseInt(url.searchParams.get("status") || "0") || 0,
          task: url.searchParams.get("task") || "",
          progress: url.searchParams.get("progress") || "0%",
          error: url.searchParams.get("error") || "",
          ver: url.searchParams.get("ver") || "未知",
          heartbeat: Date.now(),
        };
        await kv.set([`client_${clientId}`], JSON.stringify(data));
      }

      let cmd = { cmd: "", task: "" };
      const cmdRes = await kv.get([`cmd_${clientId}`]);
      if (cmdRes.value) {
        const parsed = JSON.parse(cmdRes.value as string);
        if (Date.now() - parsed.time < 5 * 60 * 1000) {
          cmd = parsed;
        }
        await kv.delete([`cmd_${clientId}`]);
      }

      return json({ ok: true, cmd: cmd.cmd || "", task: cmd.task || "" }, 200, headers);
    }

    // ===== 上报状态 =====
    if (path === "/report" && method === "GET") {
      const clientId = url.searchParams.get("client") || "1";
      const data = {
        status: parseInt(url.searchParams.get("status") || "0") || 0,
        task: url.searchParams.get("task") || "",
        progress: url.searchParams.get("progress") || "0%",
        error: url.searchParams.get("error") || "",
        ver: url.searchParams.get("ver") || "未知",
        heartbeat: Date.now(),
      };
      await kv.set([`client_${clientId}`], JSON.stringify(data));
      return json({ ok: true }, 200, headers);
    }

    // ===== 拉所有客户端状态 =====
    if (path === "/list" && method === "GET") {
      const now = Date.now();
      const iter = kv.list({ prefix: ["client_"] });
      const results = [];
      for await (const entry of iter) {
        const id = (entry.key[0] as string).replace("client_", "");
        const data = JSON.parse(entry.value as string);
        data.online = (now - data.heartbeat < 60000);
        data.id = id;
        results.push(data);
      }
      const clients = results.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      return json(clients, 200, headers);
    }

    // ===== 下发单客户端指令 =====
    if (path === "/send" && method === "GET") {
      const clientId = url.searchParams.get("client") || "1";
      const cmd = {
        cmd: url.searchParams.get("cmd") || "",
        task: url.searchParams.get("task") || "",
        time: Date.now(),
      };
      await kv.set([`cmd_${clientId}`], JSON.stringify(cmd));
      return json({ ok: true }, 200, headers);
    }

    // ===== 客户端拉指令 =====
    if (path === "/getcmd" && method === "GET") {
      const clientId = url.searchParams.get("client") || "1";
      const res = await kv.get([`cmd_${clientId}`]);
      if (!res.value) return json({ ok: true, cmd: "" }, 200, headers);
      const cmd = JSON.parse(res.value as string);
      await kv.delete([`cmd_${clientId}`]);
      if (Date.now() - cmd.time > 5 * 60 * 1000) {
        return json({ ok: true, cmd: "" }, 200, headers);
      }
      return json({ ok: true, ...cmd }, 200, headers);
    }

    // ===== 批量下发（循环写） =====
    if (path === "/sendall" && method === "GET") {
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

    // ===== 清理离线客户端 =====
    if (path === "/cleanup" && method === "GET") {
      const now = Date.now();
      const iter = kv.list({ prefix: ["client_"] });
      let cleaned = 0;
      for await (const entry of iter) {
        const data = JSON.parse(entry.value as string);
        if (now - data.heartbeat > 24 * 3600 * 1000) {
          await kv.delete(entry.key);
          cleaned++;
        }
      }
      return json({ ok: true, cleaned }, 200, headers);
    }

    // ===== 上传脚本 =====
    if (path === "/upload_script" && method === "POST") {
      const name = (url.searchParams.get("name") || "任务主脚本");
      const body = await request.text();
      const ver = Date.now().toString();
      await kv.set([`script_${name}`], body);
      await kv.set([`script_ver_${name}`], ver);
      return json({ ok: true, name, size: body.length, ver }, 200, headers);
    }

    // ===== 查脚本版本 =====
    if (path === "/script_version" && method === "GET") {
      const name = (url.searchParams.get("name") || "任务主脚本");
      const res = await kv.get([`script_ver_${name}`]);
      return json({ ok: true, ver: (res.value as string) || "" }, 200, headers);
    }

    // ===== 下载脚本 =====
    if (path === "/get_script" && method === "GET") {
      const name = (url.searchParams.get("name") || "任务主脚本");
      const res = await kv.get([`script_${name}`]);
      return new Response((res.value as string) || "", {
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return json({
      msg: "中控服务端运行中",
      endpoints: ["/sync", "/report", "/list", "/send", "/getcmd", "/sendall",
                  "/cleanup", "/upload_script", "/script_version", "/get_script"],
    }, 200, headers);
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
