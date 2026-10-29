// Node 18 has no global File, which undici (used by vsce) expects at require
// time. Defining it here is enough for packaging to work.
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File {};
}
