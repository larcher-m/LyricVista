// Launch Electron with ELECTRON_RUN_AS_NODE unset.
// This env var (if set to 1) makes Electron run as plain Node.js — no Electron API.
const { spawn } = require("child_process");
const path = require("path");

const electronExe = path.join(__dirname, "..", "node_modules", "electron", "dist", "electron.exe");
const args = process.argv.slice(2);

// Unset ELECTRON_RUN_AS_NODE in the child process's environment
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronExe, args, {
  stdio: "inherit",
  env,
});

child.on("close", (code) => process.exit(code || 0));
child.on("error", (err) => {
  console.error("Failed to launch Electron:", err.message);
  process.exit(1);
});
