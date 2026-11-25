// Lets `node --test` load src files that import each other without an extension, as the Rollup build
// needs them to (the build's tsconfig refuses ".ts" in an import path).
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});
