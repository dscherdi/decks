import preprocess from 'svelte-preprocess';

export default {
  // Consult https://github.com/sveltejs/svelte-preprocess
  // for more information about preprocessors
  preprocess: preprocess({
    typescript: {
      // Use tsconfig.json from the current directory
      tsconfigFile: './tsconfig.json'
    },
  }),
  compilerOptions: {
    // Enable runtime checks when not in production
    dev: process.env.NODE_ENV !== 'production',
  }
};