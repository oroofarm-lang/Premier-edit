/** @type {import('next').NextConfig} */
const nextConfig = {
  // These ship native binaries alongside non-JS files; bundling them breaks the
  // build, and the binary paths they export only resolve outside the bundle.
  experimental: {
    serverComponentsExternalPackages: [
      "@ffprobe-installer/ffprobe",
      "ffmpeg-static",
    ],
  },
};

export default nextConfig;
