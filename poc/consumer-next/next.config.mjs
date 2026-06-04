/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Server-only dependencies that must not be bundled by webpack. Anything that
  // touches the filesystem, native modules, or relies on Node runtime resolution
  // belongs here so it stays an external `require()` in the server output.
  serverExternalPackages: [
    "@naskot/node-hmac-auth-core",
    "@naskot/node-hmac-auth-core-propagation",
    "amqplib",
    "mysql2",
    "redis",
  ],
};

export default nextConfig;
