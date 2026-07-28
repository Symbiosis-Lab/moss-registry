import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  // Fetch schema via introspection from live endpoint
  schema: "https://server.matters.town/graphql",
  documents: ["src/queries/**/*.graphql"],
  generates: {
    // Generate TypeScript types from schema and operations
    "./src/__generated__/types.ts": {
      plugins: ["typescript", "typescript-operations"],
      config: {
        enumsAsTypes: true,
        preResolveTypes: true,
        skipTypename: true,
        // Use 'Maybe' for nullable fields
        maybeValue: "T | null | undefined",
      },
    },
    // Save introspected schema locally for reference
    "./src/__generated__/schema.graphql": {
      plugins: ["schema-ast"],
    },
  },
};

export default config;
