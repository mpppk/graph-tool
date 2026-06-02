// Type declarations for Bun's import-with-type-text attribute
declare module "*.sql" {
  const content: string;
  export default content;
}

// Allow side-effect CSS imports (TypeScript 6.0+ requires explicit declarations)
declare module "*.css";
declare module "@xyflow/react/dist/style.css";
