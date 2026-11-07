/**
 * Standard International Morse Code Library
 * Supports bi-directional encode/decode and command parsing.
 */

const MORSE_MAP: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  ':': '---...',
  '?': '..--..',
  '-': '-....-',
  '/': '-..-.',
  ' ': '/',
};

const REVERSE_MORSE_MAP: Record<string, string> = Object.entries(MORSE_MAP).reduce(
  (acc, [char, code]) => {
    acc[code] = char;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * Encode ASCII text into standard Morse code tokens separated by spaces.
 * Words are separated by ' / '.
 */
export function encodeMorse(text: string): string {
  const upper = text.toUpperCase().trim();
  const words = upper.split(/\s+/);

  return words
    .map((word) =>
      word
        .split('')
        .map((char) => MORSE_MAP[char] || '')
        .filter(Boolean)
        .join(' ')
    )
    .join(' / ');
}

/**
 * Decode Morse code string back into uppercase text.
 */
export function decodeMorse(morse: string): string {
  const cleanMorse = morse.trim();
  if (!cleanMorse) return '';

  // Split by word separator ' / ' or ' /' or multiple spaces
  const words = cleanMorse.split(/\s*\/\s*|\s{3,}/);

  return words
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .map((token) => REVERSE_MORSE_MAP[token] || '?')
        .join('')
    )
    .join(' ')
    .trim();
}

/**
 * Check if an input text represents Morse code
 */
export function isMorseCode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // A string is Morse if it consists mainly of '.', '-', ' ', and '/'
  const morseChars = trimmed.replace(/[\.\-\s\/]/g, '');
  return morseChars.length === 0 && (trimmed.includes('.') || trimmed.includes('-'));
}

/**
 * Parse financial transfer command from text (or decoded text).
 * Returns recipient address and amount if present, or null if benign.
 */
export function parseTransferFromDecoded(text: string): { recipient: string; amountUsdc: string } | null {
  const upper = text.toUpperCase();

  // Must contain transfer keywords
  const hasTransferKeyword =
    upper.includes('CHUYEN') ||
    upper.includes('TRANSFER') ||
    upper.includes('SEND') ||
    upper.includes('RUT') ||
    upper.includes('DRAIN') ||
    upper.includes('PAYOUT');

  if (!hasTransferKeyword) {
    return null;
  }

  // Look for 0x address
  const addrMatch = text.match(/0x[a-fA-F0-9]{40}/i);
  if (!addrMatch) {
    return null;
  }

  // Look for amount (e.g. 50 USDC or 50.00)
  const amountMatch = upper.match(/(\d+(?:\.\d+)?)\s*(?:USDC|USD|TOKEN)?/);
  const amountUsdc = amountMatch ? amountMatch[1] : '50.00';

  return {
    recipient: addrMatch[0],
    amountUsdc,
  };
}
