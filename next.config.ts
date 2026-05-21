import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Картинки товаров в mock-данных лежат на Unsplash.
    // После подключения реального API сюда добавятся домены загруженных изображений.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
