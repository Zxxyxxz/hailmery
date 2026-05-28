import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // tests/rls.test.ts is a standalone tsx script (run via `pnpm test:rls`),
    // not a vitest suite — it connects to a live DB and calls process.exit.
    exclude: [...configDefaults.exclude, 'tests/rls.test.ts'],
  },
});
