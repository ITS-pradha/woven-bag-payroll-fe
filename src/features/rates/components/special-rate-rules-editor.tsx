import type { CalculationPolicyDraft } from "../model/calculation-policy-draft";

type Rule = CalculationPolicyDraft["specialRules"][number];

interface SpecialRateRulesEditorProps {
  rules: Rule[];
  disabled: boolean;
  onChange: (rules: Rule[]) => void;
}

export function SpecialRateRulesEditor({
  rules,
  disabled,
  onChange,
}: SpecialRateRulesEditorProps) {
  function update(index: number, patch: Partial<Rule>) {
    onChange(
      rules.map((rule, current) =>
        current === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  return (
    <section className="border-t border-border pt-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold">Tarif khusus</h3>
          <p className="text-[0.625rem] text-muted">
            Prioritas terkecil diperiksa lebih dahulu oleh server.
          </p>
        </div>
        {!disabled ? (
          <button
            type="button"
            className="min-h-7 border border-border px-2 text-[0.6875rem] font-semibold"
            onClick={() =>
              onChange([
                ...rules,
                {
                  clientRuleId: crypto.randomUUID(),
                  priority: rules.length + 1,
                  sourceType: null,
                  widthOperator: "EQUALS",
                  widthFromCm: "0",
                  widthToCm: null,
                  ratePerMeter: "0",
                },
              ])
            }
          >
            Tambah aturan
          </button>
        ) : null}
      </div>
      {rules.length === 0 ? (
        <p className="mt-2 border border-dashed border-border p-3 text-center text-xs text-muted">
          Tidak ada tarif khusus.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table
            className="w-full min-w-[48rem] border-collapse text-xs"
            aria-label="Tarif khusus"
          >
            <thead className="bg-grid-header text-grid-header-foreground">
              <tr>
                {[
                  "Prioritas",
                  "Sumber",
                  "Kondisi lebar",
                  "Dari [cm]",
                  "Sampai [cm]",
                  "Tarif [Rp/m]",
                  "",
                ].map((label) => (
                  <th
                    key={label || "action"}
                    className="border border-grid-border p-1 text-left"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={rule.clientRuleId}>
                  <CellInput
                    label={`Prioritas aturan ${index + 1}`}
                    value={String(rule.priority)}
                    disabled={disabled}
                    type="number"
                    onChange={(value) =>
                      update(index, { priority: Number(value) })
                    }
                  />
                  <td className="border border-grid-border p-0">
                    <select
                      aria-label={`Sumber aturan ${index + 1}`}
                      className="min-h-8 w-full border-0 bg-transparent px-1 disabled:bg-surface-muted"
                      value={rule.sourceType ?? "ALL"}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          sourceType:
                            event.target.value === "ALL"
                              ? null
                              : (event.target.value as "MANUAL" | "LDMS"),
                        })
                      }
                    >
                      <option value="ALL">Semua</option>
                      <option value="MANUAL">Manual</option>
                      <option value="LDMS">LDMS</option>
                    </select>
                  </td>
                  <td className="border border-grid-border p-0">
                    <select
                      aria-label={`Kondisi lebar aturan ${index + 1}`}
                      className="min-h-8 w-full border-0 bg-transparent px-1 disabled:bg-surface-muted"
                      value={rule.widthOperator}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          widthOperator: event.target
                            .value as Rule["widthOperator"],
                        })
                      }
                    >
                      <option value="EQUALS">Sama dengan</option>
                      <option value="GREATER_THAN">Lebih dari</option>
                      <option value="GREATER_THAN_OR_EQUAL">Minimal</option>
                      <option value="RANGE">Rentang</option>
                    </select>
                  </td>
                  <CellInput
                    label={`Lebar awal aturan ${index + 1}`}
                    value={rule.widthFromCm}
                    disabled={disabled}
                    onChange={(value) => update(index, { widthFromCm: value })}
                  />
                  <CellInput
                    label={`Lebar akhir aturan ${index + 1}`}
                    value={rule.widthToCm ?? ""}
                    disabled={disabled || rule.widthOperator !== "RANGE"}
                    onChange={(value) =>
                      update(index, { widthToCm: value || null })
                    }
                  />
                  <CellInput
                    label={`Tarif aturan ${index + 1}`}
                    value={rule.ratePerMeter}
                    disabled={disabled}
                    onChange={(value) => update(index, { ratePerMeter: value })}
                  />
                  <td className="border border-grid-border p-1 text-center">
                    {!disabled ? (
                      <button
                        type="button"
                        className="min-h-7 px-2 font-semibold text-danger"
                        onClick={() =>
                          onChange(
                            rules.filter((_, current) => current !== index),
                          )
                        }
                      >
                        Hapus
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CellInput({
  label,
  value,
  disabled,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  type?: "text" | "number";
  onChange: (value: string) => void;
}) {
  return (
    <td className="border border-grid-border p-0">
      <input
        aria-label={label}
        type={type}
        inputMode="decimal"
        min={type === "number" ? 1 : undefined}
        className="min-h-8 w-full border-0 bg-transparent px-2 text-right focus:outline-2 focus:-outline-offset-2 focus:outline-focus disabled:bg-surface-muted"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </td>
  );
}
