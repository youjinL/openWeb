import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (
            id.includes('antd') ||
            id.includes('@ant-design') ||
            id.includes('@rc-component') ||
            id.includes('/rc-')
          ) {
            return 'antd';
          }
          if (
            id.includes('react-markdown') ||
            id.includes('remark-') ||
            id.includes('rehype-') ||
            id.includes('unist-') ||
            id.includes('mdast-') ||
            id.includes('micromark') ||
            id.includes('highlight.js') ||
            id.includes('lowlight') ||
            id.includes('hast-util') ||
            id.includes('hastscript') ||
            id.includes('estree-util') ||
            id.includes('property-information') ||
            id.includes('space-separated-tokens') ||
            id.includes('comma-separated-tokens') ||
            id.includes('stringify-entities') ||
            id.includes('parse-entities') ||
            id.includes('character-entities') ||
            id.includes('decode-named-character-reference') ||
            id.includes('html-void-elements') ||
            id.includes('web-namespaces') ||
            id.includes('vfile') ||
            id.includes('unist-builder') ||
            id.includes('ccount') ||
            id.includes('trim-lines') ||
            id.includes('collapse-white-space') ||
            id.includes('devlop') ||
            id.includes('trough') ||
            id.includes('bail') ||
            id.includes('zwitch') ||
            id.includes('is-buffer') ||
            id.includes('/classnames/')
          ) {
            return 'markdown';
          }
          if (
            id.includes('react') ||
            id.includes('scheduler') ||
            id.includes('@babel/runtime') ||
            id.includes('@remix-run')
          ) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5173',
        changeOrigin: true,
      },
    },
  },
});