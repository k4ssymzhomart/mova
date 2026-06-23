/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // onnxruntime-web pulls in node-only shims it never uses in the browser build; stub them so the
    // client bundle compiles. The actual WASM artifacts are served from a CDN at runtime
    // (ort.env.wasm.wasmPaths in useOnnxModel), so nothing needs bundling here.
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
