'use client';

import { useState } from 'react';
import type {
  ThesisEvaluated,
  ThesisTrigger,
  ThesisTriggerMetric,
  ThesisRole,
  EvaluatedTrigger,
} from '@/lib/types';

const METRIC_LABEL: Record<ThesisTriggerMetric, string> = {
  below_50d: 'Closes below 50-day average',
  below_200d: 'Closes below 200-day average (trend break)',
  price_below: 'Price falls below',
  eps_revisions_down: 'Forward EPS revisions turn negative',
  earnings_miss: 'Earnings miss (>5%)',
  analyst_downgrade: 'Analyst downgrade',
};
const METRICS = Object.keys(METRIC_LABEL) as ThesisTriggerMetric[];

const ROLE_LABEL: Record<ThesisRole, string> = {
  compounder: 'Compounder',
  trade: 'Trade',
  speculative: 'Speculative',
};

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// The default sell-rule set for a compounder — the discipline starting point.
function defaultTriggers(): ThesisTrigger[] {
  return [
    { id: newId(), kind: 'auto', metric: 'below_200d', text: METRIC_LABEL.below_200d },
    { id: newId(), kind: 'auto', metric: 'eps_revisions_down', text: METRIC_LABEL.eps_revisions_down },
    { id: newId(), kind: 'auto', metric: 'analyst_downgrade', text: METRIC_LABEL.analyst_downgrade },
    { id: newId(), kind: 'manual', text: 'Growth / retention decelerates two quarters' },
  ];
}

async function saveThesis(body: Record<string, unknown>): Promise<void> {
  await fetch('/api/theses', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default function ThesisCard({
  ticker,
  thesis,
  currentPrice,
  onChanged,
}: {
  ticker: string;
  thesis: ThesisEvaluated | null;
  currentPrice: number | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!thesis) {
    return (
      <div className="mt-3 border-t border-gray-200/70 pt-2.5">
        <button
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          + Add thesis &amp; sell rules
        </button>
        {editing && (
          <ThesisEditor
            ticker={ticker}
            thesis={null}
            currentPrice={currentPrice}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onChanged();
            }}
          />
        )}
      </div>
    );
  }

  async function toggleManual(tr: EvaluatedTrigger) {
    if (!thesis) return;
    const triggers = thesis.triggers.map((t) => (t.id === tr.id ? { ...t, fired: !t.fired } : t));
    await saveThesis({
      ticker,
      role: thesis.role,
      thesis: thesis.thesis,
      target_weight: thesis.target_weight,
      triggers,
    });
    onChanged();
  }

  const fired = thesis.firedCount;
  return (
    <div className="mt-3 border-t border-gray-200/70 pt-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">Thesis</span>
          {thesis.role && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
              {ROLE_LABEL[thesis.role]}
            </span>
          )}
          {thesis.target_weight != null && <span>· target {thesis.target_weight}%</span>}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
        >
          Edit
        </button>
      </div>

      {thesis.thesis && <p className="mt-1 text-xs italic text-gray-600">“{thesis.thesis}”</p>}

      {/* The verdict: intact vs a real trigger fired */}
      <div
        className={`mt-2 rounded px-2 py-1 text-[11px] font-medium ${
          fired > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
        }`}
      >
        {fired > 0
          ? `⚠ ${fired} of ${thesis.triggerCount} sell trigger${fired > 1 ? 's' : ''} fired — review`
          : `✓ Thesis intact — 0 of ${thesis.triggerCount} triggers fired`}
      </div>

      <ul className="mt-2 space-y-1">
        {thesis.evaluated.map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-[11px]">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                t.fired ? 'bg-red-500' : t.evaluatable ? 'bg-green-400' : 'bg-gray-300'
              }`}
            />
            <span className={t.fired ? 'text-red-700' : 'text-gray-600'}>{t.text}</span>
            {t.detail && <span className="text-gray-400">· {t.detail}</span>}
            {t.kind === 'manual' && (
              <button
                onClick={() => toggleManual(t)}
                className="ml-auto text-[10px] text-gray-400 hover:text-gray-700"
              >
                {t.fired ? 'mark not fired' : 'mark fired'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <ThesisEditor
          ticker={ticker}
          thesis={thesis}
          currentPrice={currentPrice}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ThesisEditor({
  ticker,
  thesis,
  currentPrice,
  onClose,
  onSaved,
}: {
  ticker: string;
  thesis: ThesisEvaluated | null;
  currentPrice: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<ThesisRole>(thesis?.role ?? 'compounder');
  const [text, setText] = useState(thesis?.thesis ?? '');
  const [weight, setWeight] = useState(thesis?.target_weight != null ? String(thesis.target_weight) : '');
  const [triggers, setTriggers] = useState<ThesisTrigger[]>(
    thesis?.triggers?.length ? thesis.triggers : defaultTriggers()
  );
  const [busy, setBusy] = useState(false);

  function updateTrigger(id: string, patch: Partial<ThesisTrigger>) {
    setTriggers((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function setMetric(id: string, metric: ThesisTriggerMetric) {
    updateTrigger(id, { metric, text: METRIC_LABEL[metric] });
  }
  function addAuto() {
    setTriggers((ts) => [...ts, { id: newId(), kind: 'auto', metric: 'below_200d', text: METRIC_LABEL.below_200d }]);
  }
  function addManual() {
    setTriggers((ts) => [...ts, { id: newId(), kind: 'manual', text: '' }]);
  }
  function removeTrigger(id: string) {
    setTriggers((ts) => ts.filter((t) => t.id !== id));
  }

  async function save() {
    setBusy(true);
    await saveThesis({
      ticker,
      role,
      thesis: text.trim() || null,
      target_weight: weight ? parseFloat(weight) : null,
      triggers: triggers.filter((t) => (t.kind === 'manual' ? t.text.trim() : true)),
    });
    setBusy(false);
    onSaved();
  }
  async function remove() {
    setBusy(true);
    await fetch(`/api/theses?ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE' });
    setBusy(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="mx-4 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:mx-0 sm:rounded-lg sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-900">{ticker} — thesis &amp; sell rules</h3>

        <div className="mt-3 flex gap-3">
          <label className="text-xs text-gray-600">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ThesisRole)}
              className="mt-1 block min-h-10 rounded-md border border-gray-300 px-2 py-1 text-base sm:min-h-0 sm:text-sm"
            >
              <option value="compounder">Compounder</option>
              <option value="trade">Trade</option>
              <option value="speculative">Speculative</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Target weight %
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="e.g. 5"
              className="mt-1 block min-h-10 w-24 rounded-md border border-gray-300 px-2 py-1 text-base sm:min-h-0 sm:text-sm"
            />
          </label>
        </div>

        <label className="mt-3 block text-xs text-gray-600">
          Thesis (why you own it)
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="The bull case in a line or two…"
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-base sm:text-sm"
          />
        </label>

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-700">Sell triggers</span>
            <div className="flex gap-2 text-[11px]">
              <button onClick={addAuto} className="min-h-10 text-blue-600 hover:text-blue-800 sm:min-h-0">+ auto</button>
              <button onClick={addManual} className="min-h-10 text-blue-600 hover:text-blue-800 sm:min-h-0">+ manual</button>
            </div>
          </div>
          <p className="mt-0.5 text-[10px] text-gray-400">
            Auto triggers self-check against price/trend &amp; analyst data. A fear without a fired
            trigger is not a sell.
          </p>

          <ul className="mt-2 space-y-2">
            {triggers.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                {t.kind === 'auto' ? (
                  <>
                    <select
                      value={t.metric}
                      onChange={(e) => setMetric(t.id, e.target.value as ThesisTriggerMetric)}
                      className="min-h-10 min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-base sm:min-h-0 sm:text-xs"
                    >
                      {METRICS.map((m) => (
                        <option key={m} value={m}>
                          {METRIC_LABEL[m]}
                        </option>
                      ))}
                    </select>
                    {t.metric === 'price_below' && (
                      <input
                        type="number"
                        value={t.param ?? ''}
                        onChange={(e) => updateTrigger(t.id, { param: e.target.value ? parseFloat(e.target.value) : null })}
                        placeholder={currentPrice ? `$${currentPrice.toFixed(0)}` : '$'}
                        className="min-h-10 w-24 rounded-md border border-gray-300 px-2 py-1 text-base sm:min-h-0 sm:w-20 sm:text-xs"
                      />
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    value={t.text}
                    onChange={(e) => updateTrigger(t.id, { text: e.target.value })}
                    placeholder="e.g. NRR falls below 115% two quarters"
                    className="min-h-10 min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-base sm:min-h-0 sm:text-xs"
                  />
                )}
                <span className="text-[9px] uppercase text-gray-400">{t.kind}</span>
                <button onClick={() => removeTrigger(t.id)} className="min-h-10 min-w-10 text-gray-400 hover:text-red-600 sm:min-h-0 sm:min-w-0">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex items-center justify-between">
          {thesis ? (
            <button onClick={remove} disabled={busy} className="min-h-10 text-xs text-red-600 hover:text-red-800 sm:min-h-0">
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="min-h-10 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 sm:min-h-0 sm:py-1.5">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="min-h-10 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:min-h-0 sm:py-1.5"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
