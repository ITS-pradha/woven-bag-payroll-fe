import { useId } from "react";

import { readableTrace, type TraceFact } from "../model/calculation-trace";
import { traceLabel, traceValue } from "../model/detail-format";

/**
 * Calculation trace satu baris produksi, dibaca seperti hitungan di kertas:
 * data yang dipakai, langkah demi langkah dengan angka baris ini, lalu harga
 * yang berlaku. ID dan rumus mentah untuk audit tetap ada, dilipat di bawah.
 */
export function CalculationTracePanel({
  stationNo,
  trace,
}: {
  stationNo: number;
  trace: Record<string, unknown>;
}) {
  const titleId = useId();
  const readable = readableTrace(trace);

  return (
    <section
      aria-labelledby={titleId}
      // The row sits in a table wider than a phone (86rem). Pinned to the
      // left edge of the scroller and no wider than the viewport, the panel
      // stays readable while the table behind it scrolls sideways.
      className="sticky left-3 w-[min(76rem,calc(100vw-2.5rem))] space-y-2.5"
    >
      <h3 id={titleId} className="text-xs font-bold">
        Cara menghitung · mesin {stationNo}
      </h3>

      {readable ? (
        <>
          {readable.notes.map((note) => (
            <p
              key={note.text}
              className={
                note.tone === "warning"
                  ? "border border-warning-border bg-warning-soft px-2 py-1 text-warning-strong"
                  : "text-muted"
              }
            >
              {note.text}
            </p>
          ))}

          <div className="grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <ol
              aria-label="Langkah perhitungan"
              className="divide-y divide-border border-y border-border"
            >
              {readable.steps.map((step, index) => (
                <li
                  key={step.key}
                  className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5 ${
                    step.muted ? "text-muted" : ""
                  }`}
                >
                  <span aria-hidden="true" className="tabular-nums text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold">{step.label}</span>
                    <span className="block text-muted">{step.working}</span>
                  </span>
                  <span
                    className={`text-right tabular-nums ${
                      step.key === "basePay" || step.key === "bonusPay"
                        ? "text-xs font-bold"
                        : "font-semibold"
                    }`}
                    title={
                      step.exact !== step.result
                        ? `Nilai persis: ${step.exact}`
                        : undefined
                    }
                  >
                    {step.result}
                  </span>
                </li>
              ))}
            </ol>

            <div className="space-y-3">
              <Facts title="Data produksi" facts={readable.inputs} />
              <Facts title="Harga" facts={readable.pricing} />
            </div>
          </div>

          <details className="group">
            <summary className="w-max cursor-pointer font-semibold text-brand-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              Detail teknis untuk audit
            </summary>
            <div className="mt-2 grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Rumus mentah per langkah</caption>
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-1 pr-3 font-semibold">
                      Langkah
                    </th>
                    <th scope="col" className="py-1 pr-3 font-semibold">
                      Rumus
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Nilai persis
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {readable.steps.map((step) => (
                    <tr
                      key={step.key}
                      className="border-b border-border align-baseline"
                    >
                      <td className="py-1 pr-3 font-mono text-[0.625rem]">
                        {step.key}
                      </td>
                      <td className="break-words py-1 pr-3 font-mono text-[0.625rem]">
                        {step.expression || "—"}
                      </td>
                      <td className="py-1 text-right font-mono text-[0.625rem] tabular-nums">
                        {step.exact}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Facts title="Referensi" facts={readable.technical} mono />
            </div>
          </details>
        </>
      ) : (
        <dl className="grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(trace).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="font-semibold text-muted">{traceLabel(key)}</dt>
              <dd className="break-words">{traceValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Facts({
  title,
  facts,
  mono = false,
}: {
  title: string;
  facts: TraceFact[];
  mono?: boolean;
}) {
  if (facts.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 font-bold">{title}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted">{fact.label}</dt>
            <dd
              className={`min-w-0 break-words ${
                mono ? "font-mono text-[0.625rem]" : "font-semibold"
              }`}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
