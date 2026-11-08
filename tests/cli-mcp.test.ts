import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { VERSION } from "../src/llm.js";
import { createMcpServer } from "../src/mcp.js";
import { stripAnsi } from "../src/terminal.js";
import { makeFakeLLM } from "./fake-llm.js";

function makeBuffers(isTTY = false) {
  let out = "";
  let err = "";
  return {
    stdout: {
      isTTY,
      columns: 80,
      write: (chunk: string) => {
        out += chunk;
        return true;
      },
    },
    stderr: {
      isTTY,
      columns: 80,
      write: (chunk: string) => {
        err += chunk;
        return true;
      },
    },
    getOut: () => out,
    getErr: () => err,
  };
}

describe("CLI (--version, rubric, --rubric, --format, TTY vs non-TTY)", () => {
  it("prints package version with --version", async () => {
    const io = makeBuffers(false);
    const code = await runCli(["node", "ship-or-theater", "--version"], io);
    expect(code).toBe(0);
    expect(io.getOut().trim()).toBe(VERSION);
  });

  it("prints rubric table with `ship-or-theater rubric` and `--rubric` without a model", async () => {
    const subIo = makeBuffers(true);
    const code1 = await runCli(["node", "ship-or-theater", "rubric"], {
      ...subIo,
      env: {},
    });
    expect(code1).toBe(0);
    expect(stripAnsi(subIo.getOut())).toContain("Reproducibility");
    expect(stripAnsi(subIo.getOut())).toContain("VERDICT BANDS");

    const flagIo = makeBuffers(false);
    const code2 = await runCli(["node", "ship-or-theater", "--rubric"], {
      ...flagIo,
      env: {},
    });
    expect(code2).toBe(0);
    expect(flagIo.getOut()).toContain("# Ship or Theater — Fixed Reality Rubric");
  });

  it("renders pretty terminal scorecard + stderr progress in TTY, and markdown in non-TTY", async () => {
    const { llm } = makeFakeLLM();

    const ttyIo = makeBuffers(true);
    const codeTty = await runCli(
      ["node", "ship-or-theater", "Our model beats GPT-4 on internal tests."],
      { ...ttyIo, llmOverride: llm, env: {} },
    );
    expect(codeTty).toBe(0);
    expect(ttyIo.getOut()).toContain("\x1b[");
    expect(stripAnsi(ttyIo.getOut())).toContain("SHIP OR THEATER");
    expect(ttyIo.getErr()).toContain("extractor");

    const nonTtyIo = makeBuffers(false);
    const codeNonTty = await runCli(
      ["node", "ship-or-theater", "Our model beats GPT-4 on internal tests."],
      { ...nonTtyIo, llmOverride: llm, env: {} },
    );
    expect(codeNonTty).toBe(0);
    expect(nonTtyIo.getOut()).toContain("# Ship or Theater — Scorecard");
    expect(nonTtyIo.getErr()).toBe("");
  });

  it("supports --format json, --json, and --no-color", async () => {
    const { llm } = makeFakeLLM();

    const jsonIo = makeBuffers(true);
    const codeJson = await runCli(
      [
        "node",
        "ship-or-theater",
        "Our model beats GPT-4.",
        "--format",
        "json",
      ],
      { ...jsonIo, llmOverride: llm, env: {} },
    );
    expect(codeJson).toBe(0);
    const parsed = JSON.parse(jsonIo.getOut());
    expect(parsed.verdict).toBe("MIXED");

    const noColorIo = makeBuffers(true);
    const codeNoColor = await runCli(
      ["node", "ship-or-theater", "Our model beats GPT-4.", "--no-color"],
      { ...noColorIo, llmOverride: llm, env: {} },
    );
    expect(codeNoColor).toBe(0);
    expect(noColorIo.getOut()).not.toContain("\x1b[");
    expect(noColorIo.getOut()).toContain("[MIXED]");
  });
});

describe("MCP server (tools and no-key SOT_PROVIDER support)", () => {
  it("lists evaluate_claim (with SOT_PROVIDER description) and calls get_rubric without API key", async () => {
    const server = createMcpServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const tools = await client.listTools();
      const evalTool = tools.tools.find((t) => t.name === "evaluate_claim");
      const rubricTool = tools.tools.find((t) => t.name === "get_rubric");

      expect(evalTool).toBeDefined();
      expect(evalTool?.description).toContain("SOT_PROVIDER");
      expect(evalTool?.description).toContain("claude");
      expect(rubricTool).toBeDefined();

      const rubricResult = await client.callTool({
        name: "get_rubric",
        arguments: {},
      });
      const content = rubricResult.content as Array<{
        type: string;
        text: string;
      }>;
      const parsed = JSON.parse(content[0]!.text) as {
        dimensions: unknown[];
        verdictBands: Record<string, string>;
      };
      expect(parsed.dimensions).toHaveLength(6);
      expect(parsed.verdictBands.SHIPS).toBe(">= 70");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
