"use strict";

const assert = require("node:assert/strict");
const { isTokenValid } = require("../src/auth.cjs");

assert.equal(isTokenValid("tok_1234abcd"), true);
assert.equal(isTokenValid("short"), false);
console.log("authentication tests passed");
