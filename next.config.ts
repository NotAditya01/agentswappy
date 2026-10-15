import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "4.5mb",
    serverActions: {
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
