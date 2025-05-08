import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { IncomingMessage, ServerResponse } from "node:http";

interface MCPConfig {
  mcpServers: {
    [key: string]: {
      command: string;
      args: string[];
    };
  };
}

const main = async (): Promise<void> => {
  // load the config and list of MCPs
  const config = JSON.parse(
    fs.readFileSync("config.json", "utf8")
  ) as MCPConfig;
  const mcpServers = Object.values(config.mcpServers);

  const clients: Client[] = [];

  const app = express();
  app.use(express.json());

  // run those MCP servers
  for (const mcpServer of mcpServers) {
    // launch a client to connect to the MCP server
    try {
      const client = new Client({
        name: "mcp-client",
        version: "1.0.0",
      });
      const transport = new StdioClientTransport({
        command: mcpServer.command,
        args: mcpServer.args,
      });
      await client.connect(transport);

      // create passthrough server
      const server = new McpServer({
        name: "mcp-server",
        version: "1.0.0",
      });

      const prompts = await client.listPrompts();
      console.log(prompts);
      const resources = await client.listResources();
      console.log(resources);
      const tools = await client.listTools();
      console.log(tools);
      for (const tool of tools.tools) {
        server.tool(
          tool.name,
          tool.description || "",
          tool.inputSchema,
          async (args) => {
            console.log(
              `tool: ${tool.name} called with args: ${JSON.stringify(args)}`
            );
            // call the client tool
            const result = await client.callTool({
              name: tool.name,
              arguments: args,
            });
            console.log(result);
            return {
              content: [{ type: "text", text: "" }],
            };
          }
        );
      }
      // Start receiving messages on stdin and sending messages on stdout

      app.post("/mcp", async (req: IncomingMessage, res: ServerResponse) => {
        // In stateless mode, create a new instance of transport and server for each request
        // to ensure complete isolation. A single instance would cause request ID collisions
        // when multiple clients connect concurrently.

        try {
          const transport: StreamableHTTPServerTransport =
            new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
            });
          res.on("close", () => {
            console.log("Request closed");
            transport.close();
            server.close();
          });
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (error) {
          console.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.write(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message: "Internal server error",
                },
                id: null,
              })
            );
            res.end();
          }
        }
      });

      clients.push(client);
    } catch (error) {
      console.error(
        `Error connecting to MCP server ${mcpServer.command} ${mcpServer.args}: ${error}`
      );
      throw error;
    }
  }

  console.log("MCP clients started");

  const PORT = 3000;
  const webServer = app.listen(PORT, () => {
    console.log(
      `MCP Stateless Streamable HTTP Server listening on port ${PORT}`
    );
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down MCP servers...");
    clients.forEach((client) => {
      client.close();
    });
    webServer.close(() => {
      console.log("Express server closed");
    });
    process.exit(0);
  });

  console.log("Graceful shutdown handler registered");
};

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
