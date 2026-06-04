// Ambient shim for side-effect CSS imports. Normally provided by Next's types
// but kept here so IDE TypeScript plugins resolve `import "./globals.css"`
// without depending on `node_modules/next/types` being indexed.
declare module "*.css";
