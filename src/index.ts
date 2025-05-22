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
import { PolicyEngine } from "./policy/PolicyEngine.js";

// Load environment variables
config();

interface MCPConfig {
  composioApps: string[];
}

interface ToolConfig {
  toolType: string;
  appName: string;
  toolName: string;
}

const main = async (): Promise<void> => {
  // output a test env var to see if loading secrets is working
  console.log("ENV_VAR_SECRET_TEST", process.env.ENV_VAR_SECRET_TEST);

  // load the config and list of MCPs
  const config = JSON.parse(
    fs.readFileSync("config.json", "utf8")
  ) as MCPConfig;
  const composioApps = config.composioApps;

  // load the tools and policies
  const permittedTools = JSON.parse(
    fs.readFileSync("tools.json", "utf8")
  ) as ToolConfig[];
  const permittedPolicies = JSON.parse(
    fs.readFileSync("policies.json", "utf8")
  );

  // Initialize policy engine
  const policyEngine = new PolicyEngine(permittedPolicies);

  // create composio client and connect to the apps
  const toolset = new OpenAIToolSet({ apiKey: process.env.COMPOSIO_API_KEY });

  const composioTools = await toolset.getTools({
    apps: composioApps,
  });

  console.log("Connected to Composio");

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
      tools: composioTools
        .filter((tool) =>
          permittedTools.map((t) => t.toolName).includes(tool.function.name)
        )
        .map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || "",
          inputSchema: tool.function.parameters,
        })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.log(`tool: ${name} called with args: ${JSON.stringify(args)}`);

    // Apply input policies
    const filteredArgs = policyEngine.applyInputPolicy(name, args!);
    console.log(
      `calling tool: ${name} with args: ${JSON.stringify(filteredArgs)}`
    );

    // Call the client tool
    const result = await toolset.executeAction({
      action: name,
      params: filteredArgs,
      entityId: "chris",
    });

    // Apply response policies
    return policyEngine.applyResponsePolicy(name, result);
  });

  // create the express server for the MCP server
  const app = express();
  app.use(express.json());

  // bind the MCP server to the express server
  app.post("/mcp", async (req: express.Request, res: express.Response) => {
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
