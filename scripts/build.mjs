import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const libDir = path.join(rootDir, "lib");

const tscBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);

function runTsc(args) {
  execFileSync(tscBin, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
}

rmSync(libDir, { recursive: true, force: true });

runTsc([
  "-p",
  "tsconfig.build.json",
  "--module",
  "commonjs",
  "--moduleResolution",
  "node10",
  "--outDir",
  "lib/commonjs",
]);

runTsc([
  "-p",
  "tsconfig.build.json",
  "--module",
  "esnext",
  "--moduleResolution",
  "bundler",
  "--outDir",
  "lib/module",
]);

runTsc([
  "-p",
  "tsconfig.build.json",
  "--declaration",
  "--declarationMap",
  "--emitDeclarationOnly",
  "--outDir",
  "lib/typescript",
]);

// Ensure CommonJS output is always treated as CommonJS regardless of parent package settings.
writeFileSync(
  path.join(libDir, "commonjs", "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

// Replace the 2.3MB string-literal .d.ts generated for vendored base64 strings with concise `string` types.
writeFileSync(
  path.join(libDir, "typescript", "pdf", "vendor", "pdfjs-bundle.d.ts"),
  [
    "export declare const PDFJS_LIB_BASE64: string;",
    "export declare const PDFJS_WORKER_BASE64: string;",
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(libDir, "typescript", "pdf", "vendor", "pdfjs-bundle.d.ts.map"),
  JSON.stringify({
    version: 3,
    file: "pdfjs-bundle.d.ts",
    sourceRoot: "",
    sources: ["../../../../src/pdf/vendor/pdfjs-bundle.ts"],
    names: [],
    mappings: "",
  }),
);

console.log("Build completed successfully in lib/{commonjs,module,typescript}");
