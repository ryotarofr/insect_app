// SpecDL.tsx — 個体カルテの仕様リスト (key/value DL)
import type { Specimen } from "../../api";

export const SpecDL = (p: { s: Specimen }) => (
  <dl style={{ margin: 0 }}>
    <div class="spec">
      <dt>種</dt>
      <dd>{p.s.species}</dd>
    </div>
    <div class="spec">
      <dt>性別</dt>
      <dd>{p.s.sex}</dd>
    </div>
    <div class="spec">
      <dt>サイズ</dt>
      <dd class="mono">{p.s.sizeMm} mm</dd>
    </div>
    <div class="spec">
      <dt>体重</dt>
      <dd class="mono">{p.s.weightG} g</dd>
    </div>
    <div class="spec">
      <dt>累代</dt>
      <dd class="mono">{p.s.generation}</dd>
    </div>
    <div class="spec">
      <dt>羽化日</dt>
      <dd class="mono">{p.s.birthDate}</dd>
    </div>
    <div class="spec">
      <dt>購入日</dt>
      <dd class="mono">{p.s.purchasedAt}</dd>
    </div>
    <div class="spec">
      <dt>購入元</dt>
      <dd>{p.s.shop}</dd>
    </div>
  </dl>
);
