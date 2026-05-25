import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Не показываем системный prompt автоматически — управляем вручную через InstallPage
      includeAssets: ["favicon.svg", "icons/icon.svg"],
      manifest: {
        name: "Кино на крыше",
        short_name: "Кино на крыше",
        description: "Бронирование мест на показах кино на крышах",
        theme_color: "#0b0b0f",
        background_color: "#0b0b0f",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "ru",
        categories: ["entertainment"],
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Кешируем весь статичный бандл
        globPatterns: ["**/*.{js,css,html,ico,svg,woff,woff2}"],
        // Не кешируем API по умолчанию через precache
        globIgnores: ["**/api/**"],
        runtimeCaching: [
          {
            // API: NetworkFirst — всегда свежие данные, 10с таймаут, fallback к кешу
            urlPattern: /\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24, // 24 ч
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Загруженные файлы (чеки, постеры): CacheFirst, 7 дней
            urlPattern: /\/uploads\//,
            handler: "CacheFirst",
            options: {
              cacheName: "uploads-cache",
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // CARTO map tiles: StaleWhileRevalidate
            urlPattern: /cartocdn\.com/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "map-tiles",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 3,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8010", ws: true, changeOrigin: true },
      "/uploads": { target: "http://127.0.0.1:8010", changeOrigin: true },
    },
  },
});
