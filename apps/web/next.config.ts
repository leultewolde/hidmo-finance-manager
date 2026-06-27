import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@hidmo/classification',
    '@hidmo/config',
    '@hidmo/contracts',
    '@hidmo/database',
    '@hidmo/finance-engine',
    '@hidmo/logging',
    '@hidmo/plaid',
  ],
}

export default nextConfig
