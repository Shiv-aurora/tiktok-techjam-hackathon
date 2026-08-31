"use strict";

function isTokenValid(token) {
  return typeof token === "string" && /^tok_[a-z0-9]{8,}$/i.test(token);
}

module.exports = { isTokenValid };
