const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const app = path.resolve(__dirname, "../app");
const provider = fs.readFileSync(path.join(app, "platform-brand.tsx"), "utf8");
const editor = fs.readFileSync(path.join(app, "branding/platform-brand-editor.tsx"), "utf8");
const signIn = fs.readFileSync(path.join(app, "company-sign-in.tsx"), "utf8");
const controller = fs.readFileSync(path.resolve(__dirname, "../../api/src/platform/platform.controller.ts"), "utf8");

test("Ringo is the reversible default company identity", () => {
  assert.match(provider, /companyName: "Ringo"/);
  assert.match(provider, /platform\/branding\/public/);
  assert.match(signIn, /brand\.companyName\.toUpperCase\(\)/);
  assert.match(controller, /filename="ringo-master-revenue\.csv"/);
  assert.doesNotMatch(controller, /filename="attend-master-revenue\.csv"/);
});

test("Master can publish company, Master, and Admin sign-in branding", () => {
  assert.match(editor, /Company name/);
  assert.match(editor, /Master colors/);
  assert.match(editor, /Master sign-in copy/);
  assert.match(editor, /Admin sign-in colors/);
  assert.match(editor, /Admin sign-in copy/);
  assert.match(editor, /method: "PATCH"/);
});
