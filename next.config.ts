import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { typedEnv: true },
  async headers() {
    return [{ source:"/:path*", headers:[
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"Permissions-Policy",value:"camera=(self), microphone=(), geolocation=()"},
      {key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains"},
    ]}];
  },
};

export default nextConfig;
