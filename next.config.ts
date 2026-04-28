import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit', 'puppeteer'],
};

export default nextConfig;
