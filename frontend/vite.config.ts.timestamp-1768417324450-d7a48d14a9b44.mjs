// vite.config.ts
import { defineConfig } from "file:///C:/Users/yash/dlxtrade/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/yash/dlxtrade/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "C:\\Users\\yash\\dlxtrade\\frontend";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  envPrefix: "VITE_",
  base: process.env.VITE_BASE_PATH || "/",
  appType: "spa",
  build: {
    target: "esnext",
    minify: false,
    cssMinify: false,
    reportCompressedSize: false,
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
          ui: ["@headlessui/react", "@heroicons/react", "recharts"],
          utils: ["axios"]
        }
      }
    },
    chunkSizeWarningLimit: 1e3
  },
  server: {
    port: 5173,
    strictPort: false,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 5173,
      clientPort: 5173,
      overlay: true
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      },
      "/ws": {
        target: "http://localhost:4000",
        ws: true,
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: false
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx5YXNoXFxcXGRseHRyYWRlXFxcXGZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx5YXNoXFxcXGRseHRyYWRlXFxcXGZyb250ZW5kXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy95YXNoL2RseHRyYWRlL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICB9LFxuICB9LFxuICBlbnZQcmVmaXg6IFwiVklURV9cIixcbiAgYmFzZTogcHJvY2Vzcy5lbnYuVklURV9CQVNFX1BBVEggfHwgXCIvXCIsXG4gIGFwcFR5cGU6IFwic3BhXCIsXG4gIGJ1aWxkOiB7XG4gICAgdGFyZ2V0OiAnZXNuZXh0JyxcbiAgICBtaW5pZnk6IGZhbHNlLFxuICAgIGNzc01pbmlmeTogZmFsc2UsXG4gICAgcmVwb3J0Q29tcHJlc3NlZFNpemU6IGZhbHNlLFxuICAgIHNvdXJjZW1hcDogZmFsc2UsXG4gICAgY3NzQ29kZVNwbGl0OiBmYWxzZSxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgdmVuZG9yOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiLCBcInJlYWN0LXJvdXRlci1kb21cIl0sXG4gICAgICAgICAgZmlyZWJhc2U6IFtcImZpcmViYXNlL2FwcFwiLCBcImZpcmViYXNlL2F1dGhcIiwgXCJmaXJlYmFzZS9maXJlc3RvcmVcIl0sXG4gICAgICAgICAgdWk6IFtcIkBoZWFkbGVzc3VpL3JlYWN0XCIsIFwiQGhlcm9pY29ucy9yZWFjdFwiLCBcInJlY2hhcnRzXCJdLFxuICAgICAgICAgIHV0aWxzOiBbXCJheGlvc1wiXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsXG4gICAgaG1yOiB7XG4gICAgICBwcm90b2NvbDogXCJ3c1wiLFxuICAgICAgaG9zdDogXCJsb2NhbGhvc3RcIixcbiAgICAgIHBvcnQ6IDUxNzMsXG4gICAgICBjbGllbnRQb3J0OiA1MTczLFxuICAgICAgb3ZlcmxheTogdHJ1ZSxcbiAgICB9LFxuICAgIHByb3h5OiB7XG4gICAgICBcIi9hcGlcIjoge1xuICAgICAgICB0YXJnZXQ6IFwiaHR0cDovL2xvY2FsaG9zdDo0MDAwXCIsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBcIi93c1wiOiB7XG4gICAgICAgIHRhcmdldDogXCJodHRwOi8vbG9jYWxob3N0OjQwMDBcIixcbiAgICAgICAgd3M6IHRydWUsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgcHJldmlldzoge1xuICAgIHBvcnQ6IDQxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBeVIsU0FBUyxvQkFBb0I7QUFDdFQsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUZqQixJQUFNLG1DQUFtQztBQUl6QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsV0FBVztBQUFBLEVBQ1gsTUFBTSxRQUFRLElBQUksa0JBQWtCO0FBQUEsRUFDcEMsU0FBUztBQUFBLEVBQ1QsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsUUFBUTtBQUFBLElBQ1IsV0FBVztBQUFBLElBQ1gsc0JBQXNCO0FBQUEsSUFDdEIsV0FBVztBQUFBLElBQ1gsY0FBYztBQUFBLElBQ2QsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBLFVBQ1osUUFBUSxDQUFDLFNBQVMsYUFBYSxrQkFBa0I7QUFBQSxVQUNqRCxVQUFVLENBQUMsZ0JBQWdCLGlCQUFpQixvQkFBb0I7QUFBQSxVQUNoRSxJQUFJLENBQUMscUJBQXFCLG9CQUFvQixVQUFVO0FBQUEsVUFDeEQsT0FBTyxDQUFDLE9BQU87QUFBQSxRQUNqQjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSx1QkFBdUI7QUFBQSxFQUN6QjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBLElBQ1osS0FBSztBQUFBLE1BQ0gsVUFBVTtBQUFBLE1BQ1YsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sWUFBWTtBQUFBLE1BQ1osU0FBUztBQUFBLElBQ1g7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLE1BQ0EsT0FBTztBQUFBLFFBQ0wsUUFBUTtBQUFBLFFBQ1IsSUFBSTtBQUFBLFFBQ0osY0FBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxFQUNkO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
