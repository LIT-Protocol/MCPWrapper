import { z, ZodRawShape, ZodType } from "zod";

const typeStringToZodType = (type: string): ZodType => {
  switch (type) {
    case "string":
      return z.string();
    case "boolean":
      return z.boolean();
    case "number":
      return z.number();
    case "datetime":
      return z.date();
    default:
      return z.any();
  }
};

// when connecting to an MCP server, you may need to run this on the inputSchema before passing it into the bridge MCP server.
// this is because it can get confused about whether the type is an input schema, or the annotations
export const objectToToolInputSchema = (obj: any): ZodRawShape => {
  const finalInputSchema: ZodRawShape = {};
  if (obj.type === "object" && obj.properties) {
    for (const key in obj.properties) {
      finalInputSchema[key] = typeStringToZodType(obj.properties[key].type);
    }
    if (obj.required) {
      finalInputSchema.required = obj.required;
    }
  }
  return finalInputSchema;
};
