import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteBin = fileURLToPath(new URL("../../bin/vite.js", import.meta.resolve("vite")));
const processes = [
  spawn(process.execPath, [viteBin], { stdio: "inherit" }),
  spawn(process.execPath, ["--watch", "server/index.js"], { stdio: "inherit" }),
];

function stop() {
  for (const child of processes) child.kill();
  process.exit();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) stop();
  });
}
