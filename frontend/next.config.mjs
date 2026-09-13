/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the lean Docker runner stage (copies only needed files)
  output: 'standalone',

  webpack: (config, { isServer }) => {
    if (isServer) {
      // maplibre-gl uses browser APIs — keep it out of the server bundle
      config.externals = [...(config.externals || []), 'maplibre-gl']
    }
    return config
  },
}

export default nextConfig
