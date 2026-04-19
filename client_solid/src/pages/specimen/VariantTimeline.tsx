// VariantTimeline.tsx — V4: タイムライン中心
// 左サイドは sticky で基本情報、右側に縦型ログ
import type { LogEntry, Specimen } from "../../api";
import { SpecDL } from "../../components/specimen/SpecDL";
import { StageBar } from "../../components/specimen/StageBar";
import { Timeline } from "../../components/specimen/Timeline";

export const VariantTimeline = (p: { s: Specimen; logs: LogEntry[] }) => (
  <div style={{ display: "grid", "grid-template-columns": "320px 1fr", gap: "32px" }}>
    <div style={{ position: "sticky", top: "72px", "align-self": "start" }}>
      <div class="ph forest" style={{ height: "220px", "margin-bottom": "12px" }}>
        <span class="ph-label">{p.s.name}</span>
      </div>
      <SpecDL s={p.s} />
      <hr class="hair" style={{ margin: "16px 0" }} />
      <StageBar stage={p.s.stage} progress={p.s.stageProgress} eta={p.s.eclosionInDays} vertical />
    </div>

    <div>
      <div class="sec-head">
        <span class="num">§</span>
        <h2>飼育タイムライン</h2>
        <span class="meta">{p.logs.length} 件 · 古い順 ↓</span>
      </div>
      <Timeline logs={[...p.logs].reverse()} />
    </div>
  </div>
);
