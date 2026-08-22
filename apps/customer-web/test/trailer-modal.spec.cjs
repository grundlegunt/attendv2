const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/lib/trailer-url.ts");
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);
const { youtubeEmbedUrl } = helperModule.exports;

test("converts supported YouTube trailer URLs to privacy-enhanced embeds", () => {
  const expected = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0";
  assert.equal(youtubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), expected);
  assert.equal(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=2"), expected);
  assert.equal(youtubeEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), expected);
});

test("rejects unsupported or malformed trailer URLs for new-tab fallback", () => {
  assert.equal(youtubeEmbedUrl("https://vimeo.com/123456"), null);
  assert.equal(youtubeEmbedUrl("not a url"), null);
  assert.equal(youtubeEmbedUrl("https://youtube.com/watch?v=bad"), null);
});
