'use strict';
const crypto = require('node:crypto');

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

const DUMMY = hashPassword('kanalik-dummy');
function verifyDummy(password) { verifyPassword(password, DUMMY.salt, DUMMY.hash); }

const newToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { hashPassword, verifyPassword, verifyDummy, newToken };
