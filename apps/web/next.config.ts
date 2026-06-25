import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@hidmo/config',
    '@hidmo/contracts',
    '@hidmo/database',
    '@hidmo/logging',
    '@hidmo/plaid',
  ],
}

export default nextConfig
