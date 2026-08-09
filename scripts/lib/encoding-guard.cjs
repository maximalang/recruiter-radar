const MOJIBAKE_PATTERN = /[\u0420\u0421][\u00a0-\u00bf\u0402-\u040f\u0452-\u045f\u2010-\u203a]/gu

function findMojibake(text) {
  return text.split(/\r?\n/u).flatMap((line, index) => {
    const matches = line.match(MOJIBAKE_PATTERN) ?? []
    return matches.length >= 2 ? [{ line: index + 1, sample: line.trim().slice(0, 160) }] : []
  })
}

module.exports = { findMojibake, MOJIBAKE_PATTERN }
