/* shared/license.js
 * License token codec (JWT-like, Ed25519-signed): "header.payload.signature",
 * each part base64url. This file only DECODES (no signature check) — verification
 * is platform-specific (Node uses crypto; the web app trusts HTTPS + optional
 * WebCrypto). Loads in Node and the browser (window.DriftlyLicense). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DriftlyLicense = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function b64urlDecode(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
    return Buffer.from(s, 'base64').toString('utf8');
  }

  function b64urlEncode(str) {
    var b;
    if (typeof btoa === 'function') b = btoa(unescape(encodeURIComponent(str)));
    else b = Buffer.from(str, 'utf8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Decode the payload WITHOUT verifying the signature. Returns null on bad input. */
  function decode(token) {
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    try { return JSON.parse(b64urlDecode(parts[1])); } catch (e) { return null; }
  }

  /** The exact bytes that are signed (header.payload). */
  function signingInput(token) {
    var parts = String(token).split('.');
    return parts.length === 3 ? parts[0] + '.' + parts[1] : null;
  }

  function signature(token) {
    var parts = String(token).split('.');
    return parts.length === 3 ? parts[2] : null;
  }

  function isExpired(payload, nowMs) {
    if (!payload || !payload.exp) return false;
    return (nowMs || Date.now()) >= payload.exp;
  }

  return {
    b64urlDecode: b64urlDecode,
    b64urlEncode: b64urlEncode,
    decode: decode,
    signingInput: signingInput,
    signature: signature,
    isExpired: isExpired,
  };
}));
