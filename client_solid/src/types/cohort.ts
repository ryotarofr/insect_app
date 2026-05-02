// types/cohort.ts — 群飼育 (cohort) ドメインの型定義 (FE-first 手書き)
//
// **Phase 1 (FE-first) 段階の手書き型**:
//   現在は mock layer (api/cohorts.ts) でこの型を扱う。
//   Phase 6 で BE が ts-rs export を吐いたあと、Phase 7 で `generated/api-types.ts`
//   から import する形に置き換え、本ファイルは削除予定。
//
// **命名規則**: BE スキーマ (snake_case) を camelCase に直したもの。
//   ts-rs のデフォルト出力と一致するよう設計。
//
// **関連**:
//   - 仕様: docs/cohort-implementation-plan.md §4 (BE 設計, §2.1 (FE-first 戦略)
//   - mock 実装: api/cohorts.ts
//   - store: store/cohorts.ts

/** cohort の由来。BE: cohorts.origin_kind CHECK 制約と同期 */
export type OriginKind = "egg_lay" | "purchase" | "field_collected";

/** cohort の現在ステージ。BE: cohorts.stage CHECK 制約と同期 */
export type CohortStage =
  | "egg"
  | "larva_l1"
  | "larva_l2"
  | "larva_l3"
  | "pupa"
  | "mixed";

/** cohort 一覧用の軽量 view (= GET /cohorts/me 想定) */
export interface CohortView {
  id: string;
  publicId: string;            // LOT-2026-0007
  ownerUserId: string;
  speciesId: string;
  speciesName?: string;        // species master から resolve した表示名 (mock 限定)
  bloodlineName?: string;      // 任意 (能勢 YG など)
  originKind: OriginKind;
  parentMatingId: string | null;
  initialCount: number;
  currentCount: number;
  stage: CohortStage;
  startDate: string;           // YYYY-MM-DD
  notes: string | null;
  archivedAt: string | null;   // ISO 8601
  version: number;
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
}

/** cohort の log 種類。BE: cohort_logs.log_type CHECK 制約と同期 */
export type CohortLogType = "feed" | "mat" | "death" | "observation";

/** cohort 単位の作業ログ */
export interface CohortLogView {
  id: string;
  cohortId: string;
  logType: CohortLogType;
  countDelta: number | null;
  metrics: Record<string, unknown> | null;
  loggedAt: string;            // ISO 8601
  authorUserId: string;
  body: string | null;
}

/** cohort 詳細用 (= GET /cohorts/:id 想定) */
export interface CohortDetailView extends CohortView {
  recentLogs: CohortLogView[];
  /** 個体化済み specimens の概略 (counts のみ、フル一覧は /specimens?cohort_id= で別取得) */
  promotedSpecimensCount: number;
}

/** cohort 新規作成のリクエスト (= POST /cohorts) */
export interface CohortInsert {
  publicId?: string;           // 省略時は自動採番
  speciesId: string;
  bloodlineName?: string;
  originKind: OriginKind;
  parentMatingId?: string | null;
  initialCount: number;
  stage: CohortStage;
  startDate: string;
  notes?: string;
}

/** 個体化リクエスト (= POST /cohorts/:id/promote) */
export interface PromoteCohortRequest {
  specimen: {
    publicId?: string;          // 省略時は自動採番
    name?: string;
    sex?: "male" | "female" | "unknown";
    weightG?: number;
    sizeMm?: number;
    stage?:
      | "larva_l1"
      | "larva_l2"
      | "larva_l3"
      | "pupa"
      | "adult";
    fatherId?: string | null;
    motherId?: string | null;
    fatherLabel?: string | null;
    motherLabel?: string | null;
    generation?: number;
    notes?: string;
  };
  log?: {
    metrics?: Record<string, unknown>;
    body?: string;
  };
}

/** 個体化レスポンス */
export interface PromoteCohortResponse {
  /** 作成された個体 (PR #5a の SpecimenView 互換 + cohort 紐付け) */
  specimen: PromotedSpecimen;
  /** current_count -1 反映後の cohort 状態 (current_count = 0 なら archivedAt も入る) */
  cohort: CohortView;
  /** このセッションの統計 */
  session: {
    promotedCountInSession: number;
    remainingInCohort: number;
    completed: boolean;          // current_count = 0 → true (= cohort も archived)
  };
}

/** 個体化で作成された specimens の最小 view (= 当面は session timeline 表示用) */
export interface PromotedSpecimen {
  id: string;
  publicId: string;
  name: string | null;
  sex: "male" | "female" | "unknown" | null;
  stage: string;
  weightG: number | null;
  sizeMm: number | null;
  cohortId: string;
  promotedFromCohortAt: string;  // ISO 8601
  notes: string | null;
}

/** 群登録の by-event entry (時系列タイムラインで cohort の "始まり" を示す) */
export interface CohortPromotionSession {
  cohortId: string;
  startedAt: string;
  /** session 開始時の current_count (= 母数) */
  denominator: number;
  promoted: PromotedSpecimen[];
}

// ──────────────────────────────────────────────────────────────────────
// 個体登録フォーム (SpecimenDetailForm) で扱う draft
// ──────────────────────────────────────────────────────────────────────

/** 個体登録 draft (`SpecimenDetailForm` の入力) */
export interface SpecimenDraft {
  publicId: string;             // 自動採番された値 (上書き可)
  name?: string;
  sex?: "male" | "female" | "unknown";
  generation?: number;
  fatherId?: string;
  motherId?: string;
  fatherLabel?: string;         // 自由記述 (野生親など)
  motherLabel?: string;
  speciesId: string;
  cohortId?: string;            // URL クエリから渡される (省略時は単独登録)
  weightG?: number;
  sizeMm?: number;
  stage?:
    | "larva_l1"
    | "larva_l2"
    | "larva_l3"
    | "pupa"
    | "adult";
  notes?: string;
  /** Phase 5 で追加: 個別メモ + 計測メモを分けたいとき */
  measurementMemo?: string;
}

/** 親個体検索 selector の結果 (= GET /specimens/search) */
export interface SpecimenSearchResult {
  id: string;
  publicId: string;
  name: string | null;
  sex: "male" | "female" | "unknown";
  sizeMm: number | null;
  weightG: number | null;
  generation: number | null;
  bloodlineName: string | null;
  speciesId: string;
  /** 死亡 / 譲渡 / 脱走 / 生存 */
  lifeStatus: "active" | "deceased" | "transferred" | "escaped";
}

/** 親個体検索のクエリパラメータ */
export interface SpecimenSearchQuery {
  q?: string;
  sex?: "male" | "female";
  speciesId?: string;
  bloodlineName?: string;
  /** 死亡個体も候補に含めるか (デフォルト true、歴史的親として有効) */
  includeDeceased?: boolean;
  limit?: number;
}
