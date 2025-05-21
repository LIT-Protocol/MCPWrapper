import JSONPath from "jsonpath";
import TurndownService from "turndown";

export interface PolicyConfig {
  toolName: string;
  paramsFilter: {
    query: string;
    [key: string]: any;
  };
  responseFilter: {
    jsonPath: string;
    contains: string[];
    convertResults?: string;
  };
}

export class PolicyEngine {
  private policies: PolicyConfig[];

  constructor(policies: PolicyConfig[]) {
    this.policies = policies;
  }

  /**
   * Applies input policies to the arguments before they are passed to the tool
   */
  public applyInputPolicy(
    toolName: string,
    args: Record<string, any>
  ): Record<string, any> {
    const policy = this.policies.find((p) => p.toolName === toolName);
    if (!policy) {
      return args;
    }

    const filteredArgs = { ...args };
    for (const [key, value] of Object.entries(policy.paramsFilter)) {
      filteredArgs[key] = value;
    }
    return filteredArgs;
  }

  /**
   * Applies response policies to the result after the tool execution
   */
  public applyResponsePolicy(toolName: string, result: any): any {
    const policy = this.policies.find((p) => p.toolName === toolName);
    if (!policy) {
      return result;
    }

    // Extract responses using JSONPath
    const extractedResponses = JSONPath.query(
      result,
      policy.responseFilter.jsonPath
    );
    console.log(`Found ${extractedResponses.length} responses`);

    // Filter results based on contains array
    let filteredResults = extractedResponses.filter((response: any) =>
      policy.responseFilter.contains.some((c) =>
        response.toLowerCase().includes(c.toLowerCase())
      )
    );

    console.log(
      `After filtering, we got ${filteredResults.length} filtered results`
    );

    // Apply conversion if specified
    if (policy.responseFilter.convertResults === "htmlToMarkdown") {
      const turndown = new TurndownService();
      turndown.remove("style");
      filteredResults = filteredResults.map((result: any) =>
        turndown.turndown(result)
      );
    }

    return {
      content: filteredResults.map((result: any) => ({
        type: "text",
        text: result,
      })),
    };
  }

  /**
   * Checks if a policy exists for a given tool
   */
  public hasPolicy(toolName: string): boolean {
    return this.policies.some((p) => p.toolName === toolName);
  }
}
