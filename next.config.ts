import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF reader and its canvas are loaded from node_modules at run time (the canvas is a native module), not bundled.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
