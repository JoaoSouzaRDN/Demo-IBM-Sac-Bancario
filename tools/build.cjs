const { buildSync } = require("esbuild");
buildSync({
  entryPoints: ["frontend/src/main.jsx"],
  bundle: true,
  external: ["/background-stars.svg"],
  minify: true,
  outfile: "frontend/assets/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
