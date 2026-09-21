/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A production build and a development server share .next by default, so running `next build` while a dev
  // server is up overwrites what that server is serving and the page comes back without its CSS. Setting
  // NEXT_DIST_DIR sends a build somewhere else: `NEXT_DIST_DIR=.next-build npx next build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
