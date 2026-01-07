/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['bcryptjs'],
  },
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'https://web-beta-seven-26.vercel.app',
  },
};

module.exports = nextConfig;
