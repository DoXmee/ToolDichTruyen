/**
 * Offline check of the proposed duplicate detector against every answer the
 * repetition lab produced. Read-only: it classifies saved files and prints how
 * each rule would have fired.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const workspace = path.resolve(import.meta.dirname, '..')
const labDirectory = path.join(workspace, 'test-results', 'repeat-lab')

const HEADING = /chương\s+(\d+)/giu

function normalize(text) {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase()
}

function bigrams(text) {
  const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const result = new Set()
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    result.add(`${tokens[index]} ${tokens[index + 1]}`)
  }
  return result
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const item of left) if (right.has(item)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

function headingPositions(text) {
  const flat = text.normalize('NFC')
  const occurrences = new Map()
  for (const match of flat.matchAll(HEADING)) {
    const number = match[1]
    const index = match.index ?? -1
    if (index < 0) continue
    occurrences.set(number, [...(occurrences.get(number) ?? []), index])
  }
  return { flat, occurrences }
}

function headingCandidates(text) {
  const { flat, occurrences } = headingPositions(text)
  const candidates = []
  for (const [number, positions] of occurrences) {
    for (let index = 1; index < positions.length; index += 1) {
      const first = positions[0]
      const second = positions[index]
      if (second <= first + 200) continue
      const similarity = jaccard(
        bigrams(normalize(flat.slice(first, first + 400))),
        bigrams(normalize(flat.slice(second, second + 400))),
      )
      const previous = flat[second - 1] ?? ''
      candidates.push({
        chapter: number,
        at: second,
        similarity,
        glued: Boolean(previous) && !/\s/u.test(previous),
      })
    }
  }
  return candidates
}

/** Rule B: the same long block appears twice anywhere in the answer. */
function longDuplicate(text) {
  const flat = normalize(text)
  for (const size of [600, 400, 300]) {
    const seen = new Map()
    for (let index = 0; index + size <= flat.length; index += 1) {
      const window = flat.slice(index, index + size)
      const previous = seen.get(window)
      if (previous !== undefined && index - previous >= size) {
        return { size, sample: window.slice(0, 80) }
      }
      if (previous === undefined) seen.set(window, index)
    }
  }
  return null
}

const files = (await readdir(labDirectory)).filter((name) => name.endsWith('.txt')).sort()
const rows = []
const tallies = { v1: 0, v2: 0, v3: 0, v4: 0 }
for (const name of files) {
  const text = await readFile(path.join(labDirectory, name), 'utf8')
  const candidates = headingCandidates(text)
  const duplicate = longDuplicate(text)
  const v1 = candidates.some((candidate) => candidate.similarity >= 0.5)
  const v2 = candidates.some((candidate) => candidate.similarity >= 0.35)
  const v3 = candidates.some((candidate) => candidate.glued)
  const v4 = candidates.some((candidate) => candidate.glued || candidate.similarity >= 0.35)
  if (v1) tallies.v1 += 1
  if (v2) tallies.v2 += 1
  if (v3) tallies.v3 += 1
  if (v4) tallies.v4 += 1
  rows.push({
    file: name.replace(/-\d{13}\.txt$/u, ''),
    chars: text.trim().length,
    tiny: text.trim().length < 150 ? 'REFUSAL' : '',
    bestSim: candidates.length ? Math.max(...candidates.map((candidate) => candidate.similarity)).toFixed(2) : '',
    glued: candidates.some((candidate) => candidate.glued) ? 'GLUED' : '',
    rules: `${v1 ? 'A1' : '--'} ${v2 ? 'A2' : '--'} ${v3 ? 'A3' : '--'} ${v4 ? 'A4' : '--'}`,
    duplicate: duplicate ? `DUP${duplicate.size}` : '',
  })
}

process.stdout.write(`${rows.map((row) => [
  row.file.padEnd(34),
  String(row.chars).padStart(6),
  row.tiny.padEnd(8),
  `sim=${row.bestSim}`.padEnd(9),
  row.glued.padEnd(6),
  row.rules.padEnd(14),
  row.duplicate,
].join(' | ')).join('\n')}\n`)
process.stdout.write(`\nSo file bi luat flag: A1(sim>=0.5)=${tallies.v1}  A2(sim>=0.35)=${tallies.v2}  A3(glued)=${tallies.v3}  A4(glued hoac sim>=0.35)=${tallies.v4} / tong ${rows.length} file\n`)
