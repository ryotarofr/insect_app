// components/recording/SpecimenSpinner.tsx — 体重 / 体長 用の数値入力 (input + ±ボタン)
//
// **設計** (docs/cohort-implementation-plan.md §3.5):
//   - 中央: <input type="number" inputmode="decimal" step="..."> (主軸)
//   - 両側: − / + ボタン (補助、ステップ単位で値を増減)
//   - PC では autoFocus + Enter で onSubmit 発火
//   - モバイルでは focus せず、+/- を親指タップで操作
//
// **キーボード操作** (input focused 時):
//   - 数字キー: 直接入力
//   - ↑ / ↓: ±step (input 標準動作 + 明示ハンドラ)
//   - + / -: ±step (オプショナル、PC ユーザ向けショートカット)
//   - Enter: onSubmit() を呼ぶ (フォーム送信)
//
// **値の正規化**:
//   step=0.1 のとき "8.20000001" を出さないように、value は内部で number→toFixed
//   して文字列化する。空文字 / NaN は undefined を保持。

import { createMemo, type JSX } from "solid-js";

interface Props {
  /** 現在値 (undefined = 未入力) */
  value: number | undefined;
  /** 値変更コールバック (NaN / 範囲外は弾いた後の値が来る) */
  onChange: (next: number | undefined) => void;
  /** ステップ刻み (体重 0.1, 体長 1 など) */
  step?: number;
  /** 単位表示 (現状は使っていないが、将来 input サフィックスで使用予定) */
  unit?: string;
  /** PC で初期 focus する */
  autoFocus?: boolean;
  /** Enter 押下時のコールバック (フォーム送信に使う) */
  onSubmit?: () => void;
  /** 入力欄の id (label 連動用) */
  id?: string;
  /** 表示用の placeholder (未入力時) */
  placeholder?: string;
  /** value の小数桁 (= step に応じる。0.1 なら 1 桁、1 なら 0 桁) */
  decimals?: number;
}

const decimalsFromStep = (step: number): number => {
  if (step >= 1) return 0;
  // 0.1 → 1, 0.01 → 2 ...
  return Math.max(0, -Math.floor(Math.log10(step)));
};

const formatValue = (
  v: number | undefined,
  decimals: number,
): string => {
  if (v === undefined || Number.isNaN(v)) return "";
  return v.toFixed(decimals);
};

const parseValue = (
  raw: string,
  decimals: number,
): number | undefined => {
  if (raw === "") return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  // 桁落とし
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
};

export const SpecimenSpinner = (props: Props) => {
  const step = () => props.step ?? 0.1;
  const decimals = () => props.decimals ?? decimalsFromStep(step());
  const display = createMemo(() => formatValue(props.value, decimals()));

  const setValue = (next: number | undefined) => {
    props.onChange(next);
  };

  const bump = (dir: 1 | -1) => {
    const cur = props.value ?? 0;
    const factor = Math.pow(10, decimals());
    const next = Math.round((cur + dir * step()) * factor) / factor;
    setValue(next);
  };

  const onInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    const raw = e.currentTarget.value;
    setValue(parseValue(raw, decimals()));
  };

  const onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (e) => {
    // Enter で送信
    if (e.key === "Enter") {
      e.preventDefault();
      props.onSubmit?.();
      return;
    }
    // +/- で増減 (input 標準の ↑↓ と並列)
    if (e.key === "+") {
      e.preventDefault();
      bump(1);
      return;
    }
    if (e.key === "-" && e.currentTarget.value !== "") {
      // input の途中で - を押すと負号として扱われるので、空でない場合のみショートカット動作
      e.preventDefault();
      bump(-1);
      return;
    }
  };

  return (
    <div class="spec-spinner">
      <button
        type="button"
        class="spec-spinner__btn"
        onClick={() => bump(-1)}
        aria-label="値を減らす"
        tabindex={-1}
      >
        −
      </button>
      <input
        id={props.id}
        type="number"
        inputmode="decimal"
        step={step()}
        class="spec-spinner__input"
        value={display()}
        placeholder={props.placeholder ?? "—"}
        onInput={onInput}
        onKeyDown={onKeyDown}
        autofocus={props.autoFocus}
      />
      <button
        type="button"
        class="spec-spinner__btn spec-spinner__btn--plus"
        onClick={() => bump(1)}
        aria-label="値を増やす"
        tabindex={-1}
      >
        +
      </button>
    </div>
  );
};
