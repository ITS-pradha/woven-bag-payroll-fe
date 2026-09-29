/**
 * Nominal rupiah untuk dibaca orang: dibulatkan ke rupiah utuh.
 *
 * Server menghitung dengan presisi penuh (mis. 3916104.1029) dan nilai itu
 * tetap yang disimpan dan dikirim; yang dibulatkan hanya tampilannya. Rupiah
 * tidak punya pecahan yang dibayarkan, jadi ",1029" hanya derau.
 *
 * Pembulatan dikerjakan pada string desimal, bukan lewat `Number`: angka
 * payroll bisa melewati 2^53 dan decimal tetap string end-to-end.
 * Setengah dibulatkan menjauhi nol (0,5 → 1, -0,5 → -1).
 */
export function formatRupiah(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer = "0", fraction = ""] = match;
  const rounded =
    fraction[0] && fraction[0] >= "5" ? increment(integer) : integer;
  const negative = Boolean(sign) && /[1-9]/.test(rounded);
  return `${negative ? "-" : ""}Rp${group(rounded)}`;
}

/**
 * Tarif per meter: desimalnya bermakna (Rp55,36/m dikali ribuan meter), jadi
 * ditampilkan apa adanya, tidak dibulatkan.
 */
export function formatRupiahRate(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer = "0", fraction] = match;
  return `${sign ? "-" : ""}Rp${group(integer)}${fraction ? `,${fraction}` : ""}`;
}

function group(integer: string) {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** +1 pada bilangan bulat dalam bentuk string, tanpa batas presisi. */
function increment(integer: string) {
  const digits = integer.split("");
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "9") {
      digits[index] = String(Number(digits[index]) + 1);
      return digits.join("");
    }
    digits[index] = "0";
  }
  return `1${digits.join("")}`;
}
