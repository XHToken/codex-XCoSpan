import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(root, "mcp", "server.mjs"), "--stdio"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: child.stdout });
let id = 0;
function call(method, params = {}) {
  const requestId = ++id;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
  return new Promise((resolve) => {
    const listener = (line) => {
      const value = JSON.parse(line);
      if (value.id === requestId) { rl.off("line", listener); resolve(value); }
    };
    rl.on("line", listener);
  });
}
console.log(JSON.stringify(await call("initialize", { protocolVersion: "2024-11-05" }), null, 2));
console.log(JSON.stringify(await call("tools/list"), null, 2));
console.log(JSON.stringify(await call("resources/list"), null, 2));
child.kill();
