// vite.config.ts
import { defineConfig } from "file:///sessions/confident-eager-cerf/mnt/insect_app/client_solid/node_modules/vite/dist/node/index.js";
import solid from "file:///sessions/confident-eager-cerf/mnt/insect_app/client_solid/node_modules/vite-plugin-solid/dist/esm/index.mjs";
var useTmp = process.env.VITE_USE_TMP_CACHE === "1";
var vite_config_default = defineConfig({
  plugins: [solid()],
  cacheDir: useTmp ? "/tmp/vite-cache" : "node_modules/.vite",
  build: {
    outDir: useTmp ? "/tmp/solid-dist" : "dist"
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    deps: {
      optimizer: {
        web: {
          include: ["solid-js"]
        }
      }
    }
  },
  resolve: {
    conditions: process.env.VITEST ? ["development", "browser"] : []
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvY29uZmlkZW50LWVhZ2VyLWNlcmYvbW50L2luc2VjdF9hcHAvY2xpZW50X3NvbGlkXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvY29uZmlkZW50LWVhZ2VyLWNlcmYvbW50L2luc2VjdF9hcHAvY2xpZW50X3NvbGlkL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9jb25maWRlbnQtZWFnZXItY2VyZi9tbnQvaW5zZWN0X2FwcC9jbGllbnRfc29saWQvdml0ZS5jb25maWcudHNcIjsvLy8gPHJlZmVyZW5jZSB0eXBlcz1cInZpdGVzdFwiIC8+XG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHNvbGlkIGZyb20gXCJ2aXRlLXBsdWdpbi1zb2xpZFwiO1xuXG5jb25zdCB1c2VUbXAgPSBwcm9jZXNzLmVudi5WSVRFX1VTRV9UTVBfQ0FDSEUgPT09IFwiMVwiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbc29saWQoKV0sXG4gIGNhY2hlRGlyOiB1c2VUbXAgPyBcIi90bXAvdml0ZS1jYWNoZVwiIDogXCJub2RlX21vZHVsZXMvLnZpdGVcIixcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6IHVzZVRtcCA/IFwiL3RtcC9zb2xpZC1kaXN0XCIgOiBcImRpc3RcIixcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgXCIvYXBpXCI6IHtcbiAgICAgICAgdGFyZ2V0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMFwiLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHRlc3Q6IHtcbiAgICBlbnZpcm9ubWVudDogXCJqc2RvbVwiLFxuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgc2V0dXBGaWxlczogW1wiLi9zcmMvdGVzdC9zZXR1cC50c1wiXSxcbiAgICBkZXBzOiB7XG4gICAgICBvcHRpbWl6ZXI6IHtcbiAgICAgICAgd2ViOiB7XG4gICAgICAgICAgaW5jbHVkZTogW1wic29saWQtanNcIl0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHJlc29sdmU6IHtcbiAgICBjb25kaXRpb25zOiBwcm9jZXNzLmVudi5WSVRFU1QgPyBbXCJkZXZlbG9wbWVudFwiLCBcImJyb3dzZXJcIl0gOiBbXSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sV0FBVztBQUVsQixJQUFNLFNBQVMsUUFBUSxJQUFJLHVCQUF1QjtBQUVsRCxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsVUFBVSxTQUFTLG9CQUFvQjtBQUFBLEVBQ3ZDLE9BQU87QUFBQSxJQUNMLFFBQVEsU0FBUyxvQkFBb0I7QUFBQSxFQUN2QztBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLFFBQ04sUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLFNBQVM7QUFBQSxJQUNULFlBQVksQ0FBQyxxQkFBcUI7QUFBQSxJQUNsQyxNQUFNO0FBQUEsTUFDSixXQUFXO0FBQUEsUUFDVCxLQUFLO0FBQUEsVUFDSCxTQUFTLENBQUMsVUFBVTtBQUFBLFFBQ3RCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxZQUFZLFFBQVEsSUFBSSxTQUFTLENBQUMsZUFBZSxTQUFTLElBQUksQ0FBQztBQUFBLEVBQ2pFO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
