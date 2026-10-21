// Decode the body of a single-quoted JS string literal without eval.
function decodeJsString(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const n = body[++i];
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case 'x': out += String.fromCharCode(parseInt(body.substr(i + 1, 2), 16)); i += 2; break;
      case 'u':
        if (body[i + 1] === '{') {
          const end = body.indexOf('}', i);
          out += String.fromCodePoint(parseInt(body.slice(i + 2, end), 16)); i = end;
        } else {
          out += String.fromCharCode(parseInt(body.substr(i + 1, 4), 16)); i += 4;
        }
        break;
      case '\n': break;
      default: out += n;
    }
  }
  return out;
}

// Find every JSON.parse('...') literal in a source file and return the parsed objects.
function extractJsonParseBlobs(src) {
  const blobs = [];
  const marker = "JSON.parse('";
  let pos = 0;
  while ((pos = src.indexOf(marker, pos)) !== -1) {
    let i = pos + marker.length;
    const start = i;
    while (i < src.length && src[i] !== "'") i += src[i] === '\\' ? 2 : 1;
    try { blobs.push(JSON.parse(decodeJsString(src.slice(start, i)))); } catch { /* not JSON */ }
    pos = i;
  }
  return blobs;
}

module.exports = { decodeJsString, extractJsonParseBlobs };
