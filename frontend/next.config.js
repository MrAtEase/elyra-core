import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rawLoaderPath = path.join(__dirname, "node_modules", "raw-loader", "dist", "cjs.js");

const shouldExport = Boolean(process.env.NEXT_STATIC_EXPORT);
const isMarketingBuild = process.env.MARKETING_BUILD === "true";
const isPlaygroundDev = process.env.ELYRA_PLAYGROUND === "1";

/** @type {import("next").NextConfig} */
const nextConfig = {
  // imapflow + nodemailer use native Node.js TCP/TLS – must not be bundled by
  // webpack/turbopack; tell Next.js to treat them as runtime externals so the
  // embedded /api/internal/email-io route compiles and runs correctly.
  serverExternalPackages: ["imapflow", "nodemailer"],

  turbopack: {
    rules: {
      "*.glsl": {
        loaders: [rawLoaderPath],
        as: "*.js",
      },
    },
  },

  webpack: (config) => {
    config.module.rules.push({
      test: /\.glsl$/,
      type: "asset/source",
    });
    const ignored = [
      "**/.logs/**",
    ];
    if (!isPlaygroundDev) {
      ignored.push("**/.run/**");
    }
    config.watchOptions = {
      ...(config.watchOptions ?? {}),
      ignored,
    };
    return config;
  },

  trailingSlash: true,
  skipTrailingSlashRedirect: true,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "fish-delish.com" },
      { protocol: "https", hostname: "www.fish-delish.com" },
      { protocol: "https", hostname: "elyra-core.app" },
      { protocol: "https", hostname: "www.elyra-core.app" },
      { protocol: "https", hostname: "*.elyra-core.app" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
    localPatterns: [{ pathname: "/assistant/**" }],
    ...(shouldExport ? { unoptimized: true } : {}),
  },

  async rewrites() {
    if (process.env.NODE_ENV === "production") {
      return [];
    }

      return [
        {
          source: "/assistant/:path*",
          destination: "http://127.0.0.1:8788/assistant/:path*",
        },
      ];
  },

  async redirects() {
    // Marketing build: redirect all app routes to app subdomain
    const allowMarketingRedirects =
      isMarketingBuild &&
      process.env.NODE_ENV === "production" &&
      process.env.DISABLE_LOCAL_APP_REDIRECTS !== "true";

    if (allowMarketingRedirects) {
      return [
        {
          source: "/workspace/:path*",
          destination: "https://app.elyra-core.app/workspace/:path*",
          permanent: false,
        },
        {
          source: "/api/:path*",
          destination: "https://app.elyra-core.app/api/:path*",
          permanent: false,
        },
        {
          source: "/signin/:path*",
          destination: "https://app.elyra-core.app/signin/:path*",
          permanent: false,
        },
        {
          source: "/admin/:path*",
          destination: "https://app.elyra-core.app/admin/:path*",
          permanent: false,
        },
      ];
    }
    return [];
  },

  ...(shouldExport ? { output: "export" } : {}),
};

export default nextConfig;
