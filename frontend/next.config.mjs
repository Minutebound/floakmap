/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the lean Docker runner stage (copies only needed files)
  output: 'standalone',

  // maplibre-gl is kept out of the server bundle by the `ssr: false` dynamic
  // import in app/page.tsx. It does NOT need a webpack externals entry — a
  // bare-string external resolves as a global variable, which is how
  // `maplibre-gl` ended up being evaluated as `maplibre - gl` in the browser.
  experimental: {
    serverComponentsExternalPackages: ['maplibre-gl'],
  },
}

export default nextConfig