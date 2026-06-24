/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Node-only shims some browser libs reference but never use; stub them so the client bundle
    // compiles. onnxruntime-web is loaded as native ESM from the CDN at runtime (see useOnnxModel),
    // so it is never bundled here.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
