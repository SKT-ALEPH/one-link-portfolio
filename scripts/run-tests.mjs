import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";

const node = process.execPath;
const server = spawn(
  node,
  ["./node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173"],
  { stdio: "ignore", windowsHide: true },
);

function isReady() {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:4173/", (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview server did not start.");
}

let exitCode = 1;
try {
  await waitForServer();
  const tests = spawn(node, ["./node_modules/@playwright/test/cli.js", "test"], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  const [code] = await once(tests, "exit");
  exitCode = code ?? 1;
} finally {
  server.kill();
}

process.exitCode = exitCode;
