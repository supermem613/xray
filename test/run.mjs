import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { minimatch } from "minimatch";
import { execSync } from "node:child_process";

const pattern = process.argv[2] || "test/**/*.test.ts";
const baseDir = pattern.split(/[/\\]/)[0] || ".";
const allFiles = readdirSync(baseDir, { recursive: true })
  .map((f) => join(baseDir, f).split("\\").join("/"))
  .filter((f) => minimatch(f, pattern));

if (allFiles.length === 0) {
  console.error(`No test files found matching: ${pattern}`);
  process.exit(1);
}

let exitCode = 0;
let totalTests = 0;
let totalPass = 0;
let totalFail = 0;
const failedFiles = [];
const sandboxHome = mkdtempSync(join(tmpdir(), "xray-test-home-"));
const childEnv = {
  ...process.env,
  HOME: sandboxHome,
  USERPROFILE: sandboxHome,
  LOCALAPPDATA: join(sandboxHome, "AppData", "Local"),
};

try {
  for (const file of allFiles) {
    const cmd = `node --import tsx --test-reporter=tap ${file}`;
    let stdout = "";
    let fileFailed = false;
    try {
      stdout = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: childEnv });
    } catch (err) {
      fileFailed = true;
      stdout = (err.stdout ?? "").toString();
      failedFiles.push(file);
    }
    process.stdout.write(stdout);
    const tests = parseInt((stdout.match(/^# tests (\d+)/m) ?? [])[1] ?? "0", 10);
    const pass = parseInt((stdout.match(/^# pass (\d+)/m) ?? [])[1] ?? "0", 10);
    const fail = parseInt((stdout.match(/^# fail (\d+)/m) ?? [])[1] ?? "0", 10);
    totalTests += tests;
    totalPass += pass;
    totalFail += fail;
    if (fileFailed && fail === 0) {
      totalFail += 1;
    }
  }
} finally {
  rmSync(sandboxHome, { recursive: true, force: true });
}
console.log(`\n# AGGREGATE: tests ${totalTests} | pass ${totalPass} | fail ${totalFail}`);
if (failedFiles.length) {
  console.log(`# Failed files:\n${failedFiles.map((f) => `#   ${f}`).join("\n")}`);
  exitCode = 1;
}
process.exit(exitCode);
