import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process") as typeof import("node:child_process");

test("search preserves matches when ripgrep reports recoverable file errors", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-rg-error-"));
  const spawnMock = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;

    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: "match",
        data: {
          path: { text: "src/kept.ts" },
          line_number: 1,
          lines: { text: "const needle = true;\n" },
        },
      })}\n`);
      child.stderr.write("rg: ./locked.db: The process cannot access the file because another process has locked a portion of the file. (os error 33)\n");
      child.emit("close", 2);
    });

    return child as ChildProcessWithoutNullStreams;
  });
  syncBuiltinESMExports();

  try {
    const { runXraySearch } = await import("../../src/core/search.js");
    const result = await runXraySearch({
      query: "needle",
      root: ws,
      globs: [],
      types: [],
      context: 0,
      max: 10,
      timeoutMs: 1000,
      regex: false,
      smart: false,
      all: true,
    });

    assert.deepEqual(result.matches.map((match) => match.path), ["src/kept.ts"]);
    assert.match(result.warnings.join("\n"), /ripgrep reported recoverable search errors/u);
  } finally {
    spawnMock.mock.restore();
    syncBuiltinESMExports();
    await rm(ws, { recursive: true, force: true });
  }
});

test("search fails loudly when ripgrep reports nonrecoverable errors", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-rg-error-"));
  const spawnMock = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;

    queueMicrotask(() => {
      child.stderr.write("regex parse error:\n  [\n  ^\nerror: unclosed character class\n");
      child.emit("close", 2);
    });

    return child as ChildProcessWithoutNullStreams;
  });
  syncBuiltinESMExports();

  try {
    const { runXraySearch } = await import("../../src/core/search.js");

    await assert.rejects(
      runXraySearch({
        query: "[",
        root: ws,
        globs: [],
        types: [],
        context: 0,
        max: 10,
        timeoutMs: 1000,
        regex: true,
        smart: false,
        all: true,
      }),
      /regex parse error/u,
    );
  } finally {
    spawnMock.mock.restore();
    syncBuiltinESMExports();
    await rm(ws, { recursive: true, force: true });
  }
});

test("smart fallback preserves recoverable ripgrep warnings from the first pass", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-rg-error-"));
  let rgCall = 0;
  const spawnMock = mock.method(childProcess, "spawn", (command: string) => {
    const callNumber = command === "git" ? 0 : rgCall += 1;
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;

    queueMicrotask(() => {
      if (callNumber === 0) {
        child.emit("close", 1);
        return;
      }
      if (callNumber === 1) {
        child.stderr.write("rg: ./locked.db: The process cannot access the file because another process has locked a portion of the file. (os error 33)\n");
        child.emit("close", 2);
        return;
      }
      if (callNumber === 4) {
        child.stdout.write(`${JSON.stringify({
          type: "match",
          data: {
            path: { text: "src/fallback.ts" },
            line_number: 3,
            lines: { text: "const fallbackNeedle = true;\n" },
          },
        })}\n`);
        child.emit("close", 0);
        return;
      }
      child.emit("close", 1);
    });

    return child as ChildProcessWithoutNullStreams;
  });
  syncBuiltinESMExports();

  try {
    const { runXraySearch } = await import("../../src/core/search.js");
    const result = await runXraySearch({
      query: "fallbackNeedle",
      root: ws,
      globs: [],
      types: [],
      context: 0,
      max: 10,
      timeoutMs: 1000,
      regex: false,
      smart: true,
      all: true,
    });

    assert.equal(result.mode, "smart");
    assert.deepEqual(result.matches.map((match) => match.path), ["src/fallback.ts"]);
    assert.match(result.warnings.join("\n"), /ripgrep reported recoverable search errors/u);
    assert.equal(rgCall, 4);
  } finally {
    spawnMock.mock.restore();
    syncBuiltinESMExports();
    await rm(ws, { recursive: true, force: true });
  }
});
