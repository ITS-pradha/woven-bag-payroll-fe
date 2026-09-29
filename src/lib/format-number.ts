/**
 * Angka desimal (string dari API) untuk dibaca orang: pemisah ribuan titik,
 * desimal koma, paling banyak `maxFractionDigits` angka di belakang koma, nol
 * di ujung dibuang ("8" bukan "8,00"; "130,28" bukan "130,2800").
 *
 * Dibulatkan setengah menjauhi nol, dikerjakan pada string — bukan lewat
 * `Number` — karena nilai payroll bisa melewati presisi float.
 * Masukan yang bukan desimal biasa dikembalikan apa adanya.
 */
export function formatNumber(value: string, maxFractionDigits = 2): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, rawInteger = "0", rawFraction = ""] = match;

  let integer = rawInteger;
  let fraction = rawFraction.slice(0, maxFractionDigits);
  if ((rawFraction[maxFractionDigits] ?? "0") >= "5") {
    const bumped = increment(
      `${integer}${fraction.padEnd(maxFractionDigits, "0")}`,
    );
    const split = bumped.length - maxFractionDigits;
    integer = maxFractionDigits > 0 ? bumped.slice(0, split) : bumped;
    fraction = maxFractionDigits > 0 ? bumped.slice(split) : "";
  }
  integer = integer.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");

  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const negative = sign === "-" && /[1-9]/.test(integer + fraction);
  return `${negative ? "-" : ""}${grouped}${fraction ? `,${fraction}` : ""}`;
}

/** +1 pada bilangan bulat dalam bentuk string, tanpa batas presisi. */
function increment(digits: string) {
  const chars = digits.split("");
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== "9") {
      chars[index] = String(Number(chars[index]) + 1);
      return chars.join("");
    }
    chars[index] = "0";
  }
  return `1${chars.join("")}`;
}
