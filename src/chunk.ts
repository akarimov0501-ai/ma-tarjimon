// The model was trained on single sentences (max 512 tokens), so long input is split
// into short pieces, translated one by one, then put back together line by line.

const MAX_CHUNK = 300;

export type Piece = { text: string; translate: boolean };

/** Splits text into pieces. Line breaks are kept as non-translated pieces. */
export function splitText(input: string): Piece[] {
  const pieces: Piece[] = [];
  const lines = input.split(/(\r?\n)/);
  for (const line of lines) {
    if (line === "\n" || line === "\r\n" || line.trim() === "") {
      pieces.push({ text: line, translate: false });
      continue;
    }
    for (const chunk of splitLine(line)) pieces.push({ text: chunk, translate: true });
  }
  return pieces;
}

function splitLine(line: string): string[] {
  if (line.length <= MAX_CHUNK) return [line];
  const sentences = line.split(/(?<=[.!?…])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > MAX_CHUNK) {
      chunks.push(cur);
      cur = s;
    } else {
      cur = cur ? cur + " " + s : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Joins translated pieces: sentences on the same line get a space between them. */
export function joinPieces(pieces: Piece[], out: string[]): string {
  let result = "";
  pieces.forEach((p, i) => {
    if (!p.translate) {
      result += p.text;
      return;
    }
    const prev = pieces[i - 1];
    if (prev && prev.translate) result += " ";
    result += out[i] ?? "";
  });
  return result;
}
