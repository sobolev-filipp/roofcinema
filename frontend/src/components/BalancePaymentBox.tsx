import { useEffect, useState } from "react";

type Props = {
  balance: number;
  total: number;
  alreadyUsed: number;
  busy?: boolean;
  onApply: (amount: number) => void | Promise<void>;
};

export default function BalancePaymentBox({ balance, total, alreadyUsed, busy, onApply }: Props) {
  const remainingDue = Math.max(0, total - alreadyUsed);
  const maxApply = Math.min(balance, remainingDue);

  const [amount, setAmount] = useState<number>(maxApply);

  useEffect(() => {
    // когда поменялся max — притянуть значение
    setAmount(Math.min(amount || maxApply, maxApply));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxApply]);

  if (remainingDue <= 0) return null;

  const fullCover = maxApply >= remainingDue;
  const after = remainingDue - amount;

  return (
    <div className="balance-payment">
      <div style={{ width: "100%" }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>На балансе: {balance.toFixed(0)} ₽</div>
          <div className="muted" style={{ fontSize: 12 }}>К доплате: {remainingDue.toFixed(0)} ₽</div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {fullCover
            ? "Можно покрыть бронь полностью с баланса — бронь закроется сразу."
            : `Можно списать до ${maxApply.toFixed(0)} ₽, остаток ${(remainingDue - maxApply).toFixed(0)} ₽ нужно будет оплатить переводом.`}
        </div>

        <div className="balance-amount-row">
          <input
            type="range"
            min={0}
            max={maxApply}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="balance-slider"
          />
          <input
            type="number"
            min={0}
            max={maxApply}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Math.min(maxApply, Number(e.target.value))))}
            className="balance-amount-input"
          />
          <span className="muted-2">₽</span>
        </div>

        <div className="row gap" style={{ marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() => setAmount(maxApply)}
            disabled={amount >= maxApply}
          >
            Списать максимум
          </button>
          <button
            className="primary"
            disabled={busy || amount <= 0}
            onClick={() => onApply(amount)}
          >
            {amount >= remainingDue
              ? `Оплатить полностью (${amount.toFixed(0)} ₽)`
              : `Списать ${amount.toFixed(0)} ₽ · останется ${after.toFixed(0)} ₽`}
          </button>
        </div>
      </div>
    </div>
  );
}
