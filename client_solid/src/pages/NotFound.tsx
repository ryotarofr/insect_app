// NotFound.tsx — 未知 URL のためのフォールバック画面
//
// **背景**:
//   旧 router は不一致 URL を全て mypage 扱いにしていたため、廃止 URL
//   (例: Strangler Fig で消した /products-sdui) を踏むと黙ってマイページが
//   表示されてしまい、リンク切れに気付きにくかった。
//   今は pathnameToRouteKey の最終フォールバックを "not-found" に倒し、
//   このコンポーネントが「ページが見つかりません」を明示する。
//
// **スタイル方針**:
//   - 既存ページの `.card` / `.cat` / chip と整合する Tailwind-less な inline style
//   - 復帰導線として「マイページへ」「商品一覧へ」を提示
//   - 凝った 404 アートは置かず、必要十分な情報のみ

import { useLocation, useNavigate } from "@solidjs/router";

export const NotFoundPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div
      style={{
        padding: "48px 16px",
        "max-width": "560px",
        margin: "0 auto",
        "text-align": "center",
      }}
    >
      <div
        class="cat"
        style={{
          color: "var(--ink-mute)",
          "letter-spacing": "0.08em",
          "font-size": "11px",
        }}
      >
        404
      </div>
      <h1 style={{ "font-size": "20px", "font-weight": 600, margin: "8px 0 12px" }}>
        ページが見つかりません
      </h1>
      <p style={{ color: "var(--ink-mute)", "font-size": "13px", margin: "0 0 4px" }}>
        指定された URL に該当するページはありません。
      </p>
      <p
        class="mono"
        style={{
          color: "var(--ink-faint)",
          "font-size": "11px",
          "margin-bottom": "24px",
          "word-break": "break-all",
        }}
      >
        {location.pathname}
      </p>

      <div style={{ display: "flex", gap: "8px", "justify-content": "center", "flex-wrap": "wrap" }}>
        <button
          type="button"
          onClick={() => navigate("/")}
          style={{
            padding: "8px 16px",
            border: "1px solid var(--bg-inverse)",
            background: "var(--bg-inverse)",
            color: "var(--ink-inverse)",
            "border-radius": "8px",
            cursor: "pointer",
            "font-size": "13px",
          }}
        >
          マイページへ
        </button>
        <button
          type="button"
          onClick={() => navigate("/products")}
          style={{
            padding: "8px 16px",
            border: "1px solid var(--line-strong)",
            background: "var(--bg)",
            color: "var(--ink)",
            "border-radius": "8px",
            cursor: "pointer",
            "font-size": "13px",
          }}
        >
          商品一覧へ
        </button>
      </div>
    </div>
  );
};
