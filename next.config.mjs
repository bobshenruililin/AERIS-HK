/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },
  transpilePackages: [
    "@deck.gl/core",
    "@deck.gl/react",
    "@deck.gl/layers",
    "@deck.gl/aggregation-layers",
    "@deck.gl/geo-layers",
    "@deck.gl/widgets",
    "@deck.gl/extensions",
    "@luma.gl/core",
    "@luma.gl/engine",
    "@luma.gl/shadertools",
    "@mapbox/tiny-sdf",
    "maplibre-gl",
    "react-map-gl",
    "@duckdb/duckdb-wasm",
  ],
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        { "@duckdb/duckdb-wasm": "commonjs @duckdb/duckdb-wasm" },
      ];
    } else {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
      config.resolve.alias = {
        ...config.resolve.alias,
        pg: false,
        "pg-native": false,
      };
    }
    return config;
  },
};

export default nextConfig;
