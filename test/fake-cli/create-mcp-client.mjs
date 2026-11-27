import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function createMcpClient(server) {
  if (!server?.command)
    throw new Error("Scenario requires the planner MCP server");
  const child = spawn(server.command, server.args ?? [], {
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = {};
  let nextId = 0;
  let closed = false;
  const lines = createInterface({ input: child.stdout });
  const exited = new Promise((resolve) => child.once("close", resolve));
  function fail(error) {
    for (const request of Object.values(pending)) request.reject(error);
  }
  child.once("error", fail);
  child.once("close", () => {
    closed = true;
    fail(new Error("MCP server exited"));
  });
  child.stdin.on("error", fail);
  lines.on("line", (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending[response.id];
    if (!request) return;
    delete pending[response.id];
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  async function request(method, params) {
    if (closed) throw new Error("MCP server exited");
    const id = ++nextId;
    const timeoutMs =
      method === "tools/call" &&
      ["blender_run", "modeler_preview"].includes(params.name)
        ? 900000
        : method === "tools/call" && params.name === "job_wait"
          ? 65000
          : 5000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        delete pending[id];
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      pending[id] = {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      };
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }
  async function close() {
    if (closed) return;
    child.stdin.end();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
    await exited;
    clearTimeout(timer);
    lines.close();
  }
  try {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "planner-fake-cli", version: "0.0.1" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    await request("tools/list", {});
    return {
      call: (step) =>
        request("tools/call", {
          name: step.name,
          arguments: step.arguments ?? {},
        }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
