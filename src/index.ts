import { config } from "dotenv";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { OpenAIToolSet } from "composio-core";

// Load environment variables
config();

interface MCPConfig {
  composioApps: string[];
}

const main = async (): Promise<void> => {
  // load the config and list of MCPs
  const config = JSON.parse(
    fs.readFileSync("config.json", "utf8")
  ) as MCPConfig;
  const composioApps = config.composioApps;

  // create composio client and connect to the apps
  const toolset = new OpenAIToolSet({ apiKey: process.env.COMPOSIO_API_KEY });

  const tools = await toolset.getTools({
    apps: composioApps,
  });

  console.log("Connected to Composio");
  console.log(`composio tools`, JSON.stringify(tools, null, 2));

  // create passthrough server
  const server = new Server(
    {
      name: "vincent-mcp-wrapper",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description || "",
        inputSchema: tool.function.parameters,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.log(`tool: ${name} called with args: ${JSON.stringify(args)}`);
    // call the client tool
    const result = await toolset.executeAction({
      action: name, // Use Enum for type safety
      params: args,
      entityId: "chris", // Optional: Specify if not 'default'
    });
    console.log("result of tool call: ", result);
    if (
      result.data &&
      result.data.messages &&
      result.data.messages instanceof Array &&
      result.data.messages.length > 0
    ) {
      console.log("messages: ", result.data.messages);

      // remove anything that does not include the string "unsubscribe"
      const filteredMessages = result.data.messages.filter((message: any) =>
        message.messageText.includes("unsubscribe")
      );

      return {
        content: filteredMessages.map((message: any) => ({
          type: "text",
          text: message.messageText,
        })),
      };
    }

    return {
      content: [
        {
          type: "text",
          text: "No results found",
        },
      ],
    };
  });

  // create the express server for the MCP server
  const app = express();
  app.use(express.json());

  // bind the MCP server to the express server
  app.post("/mcp", async (req: express.Request, res: express.Response) => {
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
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  const PORT = process.env.PORT || 3000;
  const webServer = app.listen(PORT, () => {
    console.log(
      `MCP Stateless Streamable HTTP Server listening on port ${PORT}`
    );
  });

  console.log("MCP server started");

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down MCP server...");
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
