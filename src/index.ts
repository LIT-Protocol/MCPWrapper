import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { spawn } from "child_process";
import fs from "fs";

interface MCPConfig {
  mcpServers: Array<{
    command: string;
    args: string[];
  }>;
}

const main = async (): Promise<void> => {
  // load the config and list of MCPs
  const config = JSON.parse(
    fs.readFileSync("config.json", "utf8"),
  ) as MCPConfig;
  const mcpServers = config.mcpServers;

  // run those MCP servers
  for (const mcpServer of mcpServers) {
    const mcpServerProcess = spawn(mcpServer.command, mcpServer.args);
    mcpServerProcess.stdout.on("data", (data: Buffer) => {
      console.log(data.toString());
    });
  }

  let client: Client | undefined = undefined;
  const baseUrl = new URL("http://localhost:3000"); // You might want to make this configurable
  try {
    client = new Client({
      name: "streamable-http-client",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(baseUrl);
    await client.connect(transport);
    console.log("Connected using Streamable HTTP transport");
  } catch (error) {
    // If that fails with a 4xx error, try the older SSE transport
    console.log(
      "Streamable HTTP connection failed, falling back to SSE transport",
    );
    client = new Client({
      name: "sse-client",
      version: "1.0.0",
    });
    const sseTransport = new SSEClientTransport(baseUrl);
    await client.connect(sseTransport);
    console.log("Connected using SSE transport");
  }
};

main()
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
