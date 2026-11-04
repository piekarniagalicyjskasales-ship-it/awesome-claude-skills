'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, saltHex, hashHex) {
  const calc = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

const scryptAsync = promisify(crypto.scrypt);

async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
  return { salt, hash };
}

async function verifyPasswordAsync(password, saltHex, hashHex) {
  const calc = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

const DUMMY = hashPassword('kanalik-dummy');
async function verifyDummy(password) { await verifyPasswordAsync(password, DUMMY.salt, DUMMY.hash); }

// Limiter nieudanych logowań (w pamięci): max prób w oknie czasu na klucz ip:username.
function createLoginLimiter({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const map = new Map(); // key -> { count, first }
  const sweep = (t) => { for (const [k, v] of map) if (t - v.first > windowMs) map.delete(k); };
  return {
    blocked(key) {
      const v = map.get(key);
      if (!v) return false;
      if (Date.now() - v.first > windowMs) { map.delete(key); return false; }
      return v.count >= max;
    },
    fail(key) {
      const t = Date.now();
      sweep(t);
      const v = map.get(key);
      if (v) v.count += 1; else map.set(key, { count: 1, first: t });
    },
    clear(key) { map.delete(key); },
    size() { return map.size; },
  };
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync, verifyDummy, createLoginLimiter, newToken, hashToken };
