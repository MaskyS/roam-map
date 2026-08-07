import * as esbuild from "esbuild";

const watching = process.argv.includes("--watch");
const production = !watching;

const options = {
  entryPoints: ["src/extension.js"],
  outfile: "extension.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "firefox115", "safari16"],
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  minify: production,
  sourcemap: watching ? "inline" : false,
  legalComments: "eof",
  logLevel: "info",
};

if (watching) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log("[roam-map] watching src/ and writing extension.js + extension.css");
} else {
  await esbuild.build(options);
}
