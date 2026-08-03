// A comment-stripping JSONC reader.
//
// `.oxlintrc.json` carries `//` comments, so `JSON.parse` cannot read it
// directly. STD-LINT-9 needs the real severity values out of it, and closing
// the recorded hole in STD-LINT-3's check needs to walk `overrides[].files`,
// so a grep is not enough for either. This strips comments while respecting
// string state: a `//` sequence inside a string value is data, not a comment,
// and must survive stripping untouched. Handles `/* */` block comments the
// same way, since JSONC permits both and oxlint's own schema files use both.
//
// Not a full JSONC grammar — no trailing-comma tolerance, because oxlint does
// not emit trailing commas into the configs this checker reads. Just enough
// to turn a real `.oxlintrc.json` into something `JSON.parse` accepts.

'use strict';

function stripJSONCComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      // Copy the escaped character verbatim, including inside a string, so an
      // escaped quote (\") does not end the string early and a literal `//`
      // inside a JSON string is never mistaken for one just past it.
      if (c === '\\' && i + 1 < n) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function readJSONC(path) {
  const fs = require('fs');
  const raw = fs.readFileSync(path, 'utf8');
  return JSON.parse(stripJSONCComments(raw));
}

module.exports = { stripJSONCComments, readJSONC };
