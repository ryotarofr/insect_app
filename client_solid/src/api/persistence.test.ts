// persistence.test.ts — addLog / updateSpecimenMemo の永続化挙動
//
// **PR #5b 以降**: 全 describe ブロックを削除済。理由:
//   - addLog (PR #6): server POST に変わり、localStorage 永続化は廃止
//     → 別レイヤ (server `handlers/specimen_logs::create_log` rust unit test) でカバー
//   - updateSpecimenMemo (PR #5b): server PATCH に変わり、localStorage 永続化は廃止
//     → 別レイヤ (server `repos/specimens::update_notes` + `handlers/specimens::patch_specimen_notes`
//       の rust unit test) でカバー
//
// **本ファイルを残す理由**: import 経路 / setup hooks の整合性を持つ「永続化テスト」の
//   置き場として残しておき、将来 client 側で fetch モック付き integration test を書く
//   時に再利用する。今は no-op テストファイル。

import { describe, it } from "vitest";

describe("api/persistence (placeholder)", () => {
  it("placeholder — server 永続化に移行済 (= localStorage 廃止)", () => {});
});
