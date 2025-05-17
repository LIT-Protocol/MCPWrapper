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
import JSONPath from "jsonpath";
import TurndownService from "turndown";

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

interface PolicyConfig {
  toolName: string;
  paramsFilter: {
    query: string;
  };
  responseFilter: {
    jsonPath: string;
    contains: string[];
    convertResults: string;
  };
}
const main = async (): Promise<void> => {
  // load the config and list of MCPs
  const config = JSON.parse(
    fs.readFileSync("config.json", "utf8")
  ) as MCPConfig;
  const composioApps = config.composioApps;

  // load the tools
  const permittedTools = JSON.parse(
    fs.readFileSync("tools.json", "utf8")
  ) as ToolConfig[];
  const permittedPolicies = JSON.parse(
    fs.readFileSync("policies.json", "utf8")
  ) as PolicyConfig[];

  // create composio client and connect to the apps
  const toolset = new OpenAIToolSet({ apiKey: process.env.COMPOSIO_API_KEY });

  const composioTools = await toolset.getTools({
    apps: composioApps,
  });

  console.log("Connected to Composio");
  // console.log(`composio tools`, JSON.stringify(composioTools, null, 2));

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
    // apply input policies
    const inputPolicy = permittedPolicies.find((p) => p.toolName === name);
    const filteredArgs = args!;
    if (inputPolicy) {
      console.log(`input policy found for tool: ${name}`);
      // if there's an input policy, replace the args with the filtered args, so that we only call the tool with filtered args.
      for (const [key, value] of Object.entries(inputPolicy.paramsFilter)) {
        filteredArgs[key] = value;
      }
    }
    console.log(
      `calling tool: ${name} with args: ${JSON.stringify(filteredArgs)}`
    );
    // call the client tool
    const result = await toolset.executeAction({
      action: name, // Use Enum for type safety
      params: filteredArgs,
      entityId: "chris", // Optional: Specify if not 'default'
    });
    // console.log("result of tool call: ", result);
    // console.log(`messages: ${JSON.stringify(result?.data?.messages, null, 2)}`);
    // apply response filters
    const responsePolicy = permittedPolicies.find((p) => p.toolName === name);
    if (responsePolicy) {
      console.log(`response policy found for tool: ${name}`);
      const extractedSubjectedForDebug = JSONPath.query(
        result,
        "$.data.messages[*].subject"
      );
      console.log(
        "subjects of the emails before filtering: ",
        extractedSubjectedForDebug
      );
      // use jsonpath to filter the response
      const extractedResponses = JSONPath.query(
        result,
        responsePolicy.responseFilter.jsonPath
      );
      console.log(`We got ${extractedResponses.length} responses`);
      // console.log("extractedResponses", extractedResponses);
      // filter the results based on the contains array
      let filteredResults = extractedResponses.filter((result: any) =>
        responsePolicy.responseFilter.contains.some((c) =>
          result.toLowerCase().includes(c.toLowerCase())
        )
      );
      console.log(
        `After filtering, we got ${filteredResults.length} filtered results`
      );
      if (
        responsePolicy.responseFilter.convertResults &&
        responsePolicy.responseFilter.convertResults === "htmlToMarkdown"
      ) {
        const turndown = new TurndownService();
        turndown.remove("style");
        filteredResults = filteredResults.map((result: any) =>
          turndown.turndown(result)
        );
        console.log(
          `After converting to markdown, we got ${filteredResults.length} results`
        );
      }
      return {
        content: filteredResults.map((result: any) => ({
          type: "text",
          text: result,
        })),
      };
    } else {
      return result;
    }
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
