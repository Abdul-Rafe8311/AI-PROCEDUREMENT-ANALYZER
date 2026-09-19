/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // @react-pdf/renderer ships its own React reconciler tied to a specific
  // "react" module instance. Left to the default app-router bundling, the
  // /api/report/export route resolves React under the RSC ("react-server")
  // condition, handing react-pdf elements it doesn't recognize — it throws
  // React error #31 ("object with keys {$$typeof, type, key, props, ...}").
  // Marking the package external makes Next require() it natively instead,
  // so it (and the React it bundles) stays outside that resolution swap.
  serverExternalPackages: ['@react-pdf/renderer'],
};

export default nextConfig;
