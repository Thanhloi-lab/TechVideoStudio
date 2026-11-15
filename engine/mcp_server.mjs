import { createMcpHandler } from "./mcp/rpc.mjs";

const PORT = Number(process.env.VIDEO_MAKER_PORT || process.env.PORT || 3030);
const HOST = process.env.VIDEO_MAKER_HOST || "127.0.0.1";

function logErr(msg) {
  process.stderr.write(`[mcp:tech-video-studio] ${msg}\n`);
}

function writeJsonRpc(obj) {
  if (obj === null || obj === undefined) return;
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const mcpHandler = createMcpHandler({ serverHost: HOST, serverPort: PORT });

let rawBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, chunk]);
  while (true) {
    const nlIdx = rawBuffer.indexOf(0x0a);
    if (nlIdx === -1) break;
    const lineBuf = rawBuffer.subarray(0, nlIdx);
    rawBuffer = rawBuffer.subarray(nlIdx + 1);
    const line = lineBuf.toString("utf-8").trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      logErr(`Invalid JSON-RPC line: ${err.message}`);
      writeJsonRpc({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    void mcpHandler
      .processMessage(parsed)
      .then((resp) => {
        if (resp) writeJsonRpc(resp);
      })
      .catch((err) => {
        logErr(`Error handling message: ${err.message}`);
        if (parsed?.id !== undefined && parsed?.id !== null) {
          writeJsonRpc({
            jsonrpc: "2.0",
            id: parsed.id,
            error: { code: -32603, message: err.message },
          });
        }
      });
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
