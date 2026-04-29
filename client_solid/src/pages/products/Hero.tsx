// pages/products/Hero.tsx — 新規訪問者向けヒーローセクション
// 3つのバリュープロポジション（BUY / RAISE / TRADE）と今週の看板個体カードを表示
import { Show, type JSX } from "solid-js";
import type { RouteKey } from "../../data";
import { getProduct, listProducts } from "../../api";
import "./hero.css";

interface HeroProps {
  setRoute: (r: RouteKey) => void;
}

const fmtPrice = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// SVGアイコン（既存Icons.tsxと同じトーン。1.7ストローク/currentColor）
const IconCarte = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 3h6v3H9z" />
    <path d="M8 11h8M8 14h8M8 17h5" />
  </svg>
);
const IconTree = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="19" r="2" />
    <path d="M12 7v5M6 17V12h12v5" />
  </svg>
);
const IconShield = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

interface PromiseProps {
  num: string;
  icon: JSX.Element;
  title: string;
  body: JSX.Element;
  link: string;
  onLink?: () => void;
}
const PromiseItem = (p: PromiseProps) => (
  <div class="hero-promise">
    <div class="hero-promise-num mono">{p.num}</div>
    <div class="hero-promise-icon">{p.icon}</div>
    <h3 class="hero-promise-title">{p.title}</h3>
    <p class="hero-promise-body">{p.body}</p>
    <button
      class="hero-promise-link mono"
      onClick={(e) => {
        e.preventDefault();
        p.onLink?.();
      }}
    >
      {p.link}
    </button>
  </div>
);

export const Hero = (props: HeroProps) => {
  // 看板個体カードの元データ（POCでは固定）
  const featured = () => getProduct("p-hh-m-142") ?? listProducts()[0];

  const goProducts = () => {
    // 既に生体・用品ページ内だが、スクロールを下に促す
    document.querySelector(".page-head")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section class="hero" aria-label="KOCHŪ の紹介">
      <div class="hero-main">
        <div class="hero-copy">
          <div class="hero-eyebrow mono">
            <span class="hero-eyebrow-rule" aria-hidden="true" />
            ようこそ KOCHŪ へ
          </div>

          <h1 class="hero-title serif">
            買う、育てる、<em>継ぐ。</em>
            <br />
            ひとつの場所で。
          </h1>

          <p class="hero-lead">
            KOCHŪ は、国産・海外産カブクワの専門EC と、購入した個体のカルテ・
            飼育ログ・羽化予測までを一体化した飼育管理プラットフォームです。
            取引の安心と、育成の継続体験を、同じ画面で。
          </p>

          <div class="hero-cta">
            <button class="btn primary lg" onClick={goProducts}>
              生体を探す →
            </button>
            <button class="btn ghost lg">KOCHŪ について</button>
          </div>

          <ul class="hero-trust mono" role="list">
            <li>累計カルテ 12,480 件</li>
            <li>認証ブリーダー 86 名</li>
            <li>死着補償 99.2%</li>
          </ul>
        </div>

        {/* 右：今週の看板個体カード。
            store/products の load 完了前は featured() が undefined なので Show でガード。 */}
        <Show when={featured()}>
          {(p) => (
            <article
              class="hero-feature card"
              onClick={() => props.setRoute("product-detail")}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && props.setRoute("product-detail")}
            >
              <div
                class="ph forest hero-feature-ph"
                role="img"
                aria-label={`${p().title} 注目商品 (プレースホルダ画像)`}
              >
                <div class="hero-feature-chips">
                  <span class="chip ink mono">注目</span>
                  <span class="chip amber">{p().badge ?? "血統書付"}</span>
                </div>
                <div class="ph-label">{p().phLabel}</div>
              </div>
              <div class="hero-feature-meta mono">
                <span>#DHH-0271 · {p().shop}</span>
                <span>{p().generation}</span>
              </div>
              <h3 class="hero-feature-title">{p().title}</h3>
              <div class="hero-feature-sci">{p().sci}</div>
              <div class="hero-feature-price">
                {fmtPrice(p().price)}
                <small>税込 / 送料別</small>
              </div>
              <div class="hero-feature-forecast">
                <span>
                  <strong>15日後に羽化予測</strong> · 2026-05-04 ±5日
                </span>
                <span class="mono">羽化予測</span>
              </div>
            </article>
          )}
        </Show>
      </div>

      {/* 3 PROMISES ストリップ */}
      <div class="hero-promises">
        <div class="hero-promises-head">
          <div class="hero-eyebrow mono forest">
            <span class="hero-eyebrow-rule forest" aria-hidden="true" />
            3つの約束
          </div>
          <h2 class="hero-promises-title serif">KOCHŪ の約束</h2>
          <p class="hero-promises-sub mono">買う · 育てる · 継ぐ</p>
        </div>

        <PromiseItem
          num="01 — 買う"
          icon={<IconCarte />}
          title="自動カルテ生成"
          body={
            <>
              チェックアウトの次の画面は、マイページ。
              <br />
              そこにはもう、あなたの個体のカルテがある。
            </>
          }
          link="→ カルテの例を見る"
          onLink={() => props.setRoute("specimen")}
        />
        <PromiseItem
          num="02 — 育てる"
          icon={<IconTree />}
          title="血統・真贋の保証"
          body={
            <>
              「CBF3」というラベルの裏に、3世代分の証拠がある。
              <br />
              親個体・交配・所有権移転まで、購入前に血統のすべてを確認できます。
            </>
          }
          link="→ 血統系図を開く"
          onLink={() => props.setRoute("bloodline")}
        />
        <PromiseItem
          num="03 — 継ぐ"
          icon={<IconShield />}
          title="死着 24h 自動補償"
          body={
            <>
              到着時の開封動画をアップするだけ。
              <br />
              明白な死着は 24 時間以内に自動返金。「届かない不安」を、仕組みで解消します。
            </>
          }
          link="→ 補償フローの詳細"
          onLink={() => props.setRoute("market")}
        />
      </div>
    </section>
  );
};
