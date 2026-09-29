import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages: the lab and its guided tour.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tour: fileURLToPath(new URL('./tour.html', import.meta.url)),
      },
    },
  },
});
