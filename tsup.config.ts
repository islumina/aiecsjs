import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'loop': 'src/loop.ts',
    'commands': 'src/commands.ts',
    'observers': 'src/observers.ts',
    'serialize': 'src/serialize.ts',
    'worker': 'src/worker.ts',
    'relations': 'src/relations.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
})
