'use strict';

const fs = require('fs');
const path = require('path');

/**
 * splitter.js — reads a data file and splits it into N line-safe chunks.
 *
 * Rules (from guide Section 4):
 *  - Never split at byte offsets — always on newline boundaries.
 *  - Divide lines into N equal groups via index arithmetic.
 *  - Write each group as chunk_<N>.txt under chunksDir.
 *  - Returns an array of chunk file paths in ascending order.
 */

/**
 * Split a plain-text / JSONL / CSV file into `numChunks` files.
 *
 * @param {string} dataFilePath  — absolute or relative path to the input data file
 * @param {string} chunksDir     — directory to write chunk files into (must exist or be created)
 * @param {number} numChunks     — how many chunks to produce
 * @returns {string[]}           — ordered array of chunk file paths
 */
function splitFile(dataFilePath, chunksDir, numChunks) {
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }

  const content = fs.readFileSync(dataFilePath, 'utf8');

  // Normalise line endings, drop trailing empty line if present
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const totalLines = lines.length;

  // Edge-case: empty file → produce a single empty chunk
  if (totalLines === 0) {
    const chunkPath = path.join(chunksDir, 'chunk_0.txt');
    fs.writeFileSync(chunkPath, '');
    return [chunkPath];
  }

  // Clamp numChunks so we never produce more chunks than there are lines
  const actualChunks = Math.min(numChunks, totalLines);

  const chunkPaths = [];

  for (let i = 0; i < actualChunks; i++) {
    // Index arithmetic: distribute lines as evenly as possible
    const start = Math.floor((i * totalLines) / actualChunks);
    const end   = Math.floor(((i + 1) * totalLines) / actualChunks);

    const chunkLines = lines.slice(start, end);
    const chunkContent = chunkLines.join('\n') + '\n';

    const chunkPath = path.join(chunksDir, `chunk_${i}.txt`);
    fs.writeFileSync(chunkPath, chunkContent, 'utf8');
    chunkPaths.push(chunkPath);
  }

  return chunkPaths;
}

module.exports = { splitFile };
