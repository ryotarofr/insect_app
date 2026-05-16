# CDN private path 雛形 — AWS 限定 (M9 / Phase 9 前)

> 設計書 `sdui-three-layer-model-v6.md` §14.5 の方針実装ガイド。**KOCHU プロジェクトのインフラは AWS 統一**のため、本ドキュメントは AWS CloudFront + CloudFront Functions + (必要に応じて) Lambda@Edge + WAF を前提とする。

## 1. 目的

認証必須 endpoint が共有 CloudFront キャッシュに乗り、別ユーザのカート / 配送先データが漏洩する事故を **path-level の物理遮断** で防ぐ。`Cache-Control: no-store` + `Vary: Cookie` は最後の防壁で、一次防衛は本ドキュメントの CloudFront 設定。

## 2. 対象 path 一覧 (Source of Truth)

以下の prefix は **CloudFront Cache Behavior で `CachingDisabled` 相当 + 全 Cookie / Auth Header forward** に切り出し、別途 viewer-response で `Cache-Control` を強制上書きする。

```
/api/v1/cards/cart                          # GET (cart snapshot, personalized)
/api/v1/cart                                # POST (add to cart)
/api/v1/cart/items/{token}                  # PATCH / DELETE (qty / remove)
/api/v1/checkout                            # GET (debug snapshot)
/api/v1/checkout/shipping_field/{name}      # PATCH (配送先 1 フィールド更新)
/api/v1/checkout/shipping_method            # PATCH (配送方法切替)
/api/v1/watch/{product_id}                  # POST (watch toggle)
/api/v1/events                              # POST / GET (analytics ingest)
```

**正規表現** (CloudFront Functions で使う):

```regex
^/api/v1/(cards/cart|cart|cart/items/.+|checkout(/.*)?|watch/.+|events)(\?.*)?$
```

**逆に CloudFront にキャッシュ可能な path** (= 既存の `CachingOptimized` Behavior に残す):

```
/api/v1/cards/products              # 一覧 (ProductListResponse, experiment.bucket でキー分割)
/api/v1/cards/products/{id}         # 単一カード
/api/v1/cards/products/{id}/detail  # 詳細
/api/v1/hello
/health
/  → /index.html, /assets/* (静的アセット = S3 origin)
```

## 3. AWS アーキテクチャ全体像

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────────┐
│  Route 53   ├───▶│  CloudFront  │───▶│ ALB / API GW (axum) │ ← /api/v1/*
│ kochu.app   │    │ Distribution │    └─────────────────────┘
└─────────────┘    │              │    ┌─────────────────────┐
                   │              ├───▶│ S3 (静的アセット)    │ ← /, /assets/*
                   │              │    └─────────────────────┘
                   │   + AWS WAF  │
                   └──────┬───────┘
                          │
              ┌───────────┴───────────┐
              │ CloudFront Functions  │ (Viewer Request / Response)
              │ ・private path 判定   │
              │ ・Cache-Control 強制  │
              └───────────────────────┘
```

**設計判断**:

- **CloudFront Functions** を **Viewer Response** phase に配置し、`Cache-Control` / `Vary` を強制上書き。Lambda@Edge より低レイテンシ・低コスト・cold start 無し。
- **Cache Policy / Origin Request Policy** を private 用と public 用で分離する (= AWS Managed Policy `CachingDisabled` と `CachingOptimized` を使い分ける)。
- **WAF** で `/api/v1/cart*` / `/api/v1/checkout*` への直接 origin アクセスを deny ルールで補助 (= CloudFront を bypass されてもブロック)。
- **API origin (axum)** は ALB 経由 (もしくは API Gateway HTTP API + Lambda) を想定。本ドキュメントは「ALB を ECS Fargate / EC2 にぶら下げる」前提で書く。

## 4. CloudFront 設定

### 4.1 Cache Behaviors (パス別)

CloudFront Distribution に **3 種類の Cache Behavior** を切る。優先順位 (Precedence) も含めて以下:

| # | Path Pattern | Origin | Cache Policy | Origin Request Policy | Response Headers Policy | CloudFront Function (Viewer Response) |
|---|---|---|---|---|---|---|
| 0 | `/api/v1/cards/cart`<br>`/api/v1/cart*`<br>`/api/v1/checkout*`<br>`/api/v1/watch/*`<br>`/api/v1/events*` | ALB (axum) | **`CachingDisabled`** (Managed) | **`AllViewer`** (= 全 header / cookie / qs forward) | カスタム (= §4.2 参照) | `enforce-private-cache` (§5) |
| 1 | `/api/v1/cards/products*`<br>`/api/v1/hello`<br>`/health` | ALB (axum) | カスタム (`SduiPublicCache`, TTL=60s, `experiment_bucket` cookie をキーに含む) | カスタム (`SduiPublicForward`) | (default) | (なし) |
| 2 (default) | `/*` | S3 (静的アセット) | `CachingOptimized` (Managed) | `CORS-S3Origin` (Managed) | (default) | (なし) |

**Path Pattern の指定**: CloudFront は単純な glob (`*`, `?`) のみサポートし、正規表現は使えない。複数 prefix を持つ Behavior を 1 つに集約できないので、**private path ごとに別 Behavior を作る**か、**`/api/v1/*` を private Behavior に倒し** Function 側で `cards/products` だけ public 扱いに分岐させる方針を取る (= 本ドキュメントは後者を推奨)。

> **推奨方針**: Behavior を 2 つに簡略化:
> - Behavior #0 (`/api/v1/*`): origin = ALB / Cache Policy = `CachingDisabled` / Function = `enforce-private-cache` (= cards/products だけ public 上書き)
> - Behavior #1 (`/*`): origin = S3 / Cache Policy = `CachingOptimized`
>
> これにより API 系は **デフォルト bypass**、`cards/products` のみ Function で `Cache-Control: public, max-age=60` を許可する設計になり、新規 endpoint 追加時の漏れ事故 (= デフォルトキャッシュされる) を防ぐ。

### 4.2 Response Headers Policy (private 用)

private path 専用の Response Headers Policy を作成し、以下を強制:

| 設定項目 | 値 |
|---|---|
| `Cache-Control` | `private, no-store, max-age=0` (Override: ON) |
| `Vary` | `Cookie, Authorization` (Override: ON) |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

**Override: ON** にすることで、origin (axum) が `Cache-Control: public` を誤って返してきても CloudFront 側で打ち消す。

### 4.3 Origin Request Policy (private 用)

private path は cookie / authorization をすべて forward する必要がある。Managed Policy `AllViewer` を使うか、必要最小限なら以下のカスタム:

| 設定項目 | 値 |
|---|---|
| Headers | `Authorization`, `Cookie`, `Origin`, `User-Agent`, `X-Forwarded-For` |
| Query strings | All |
| Cookies | All |

## 5. CloudFront Functions

### 5.1 `enforce-private-cache` (Viewer Response)

`enforce-private-cache.cf2.js`:

```javascript
/**
 * SDUI 認証必須 endpoint の private 強制 (M9 / 設計書 §14.5)
 *
 * Behavior `/api/v1/*` の Viewer Response に associate する。
 * private path (= cards/products 以外の API 系) に対しては
 * Cache-Control / Vary を強制上書きする。
 *
 * **CloudFront Functions の制約**:
 *   - 同期 JS のみ。fetch / Promise は使えない。
 *   - 1ms 程度の処理時間制限。重いロジックは Lambda@Edge へ。
 *   - ES5 ベース (var / function 推奨)。
 */

function handler(event) {
  var response = event.response;
  var uri = event.request.uri;

  // CloudFront Functions は正規表現を使えるが ES5 構文に倒す。
  var PRIVATE_RE = /^\/api\/v1\/(cards\/cart|cart|cart\/items\/.+|checkout(\/.*)?|watch\/.+|events)(\?.*)?$/;

  // public 許可 path (= cards/products 系) は何もしない (= Cache-Control は origin の値を尊重)
  if (uri.indexOf("/api/v1/cards/products") === 0) {
    return response;
  }

  // それ以外の /api/v1/* はすべて private 強制
  if (PRIVATE_RE.test(uri) || uri.indexOf("/api/v1/") === 0) {
    response.headers["cache-control"] = {
      value: "private, no-store, max-age=0",
    };
    var existingVary = (response.headers["vary"] && response.headers["vary"].value) || "";
    var vs = {};
    existingVary.split(",").forEach(function (s) {
      var k = s.trim();
      if (k.length > 0) vs[k.toLowerCase()] = k;
    });
    vs["cookie"] = "Cookie";
    vs["authorization"] = "Authorization";
    var keys = Object.keys(vs).map(function (k) { return vs[k]; });
    response.headers["vary"] = { value: keys.join(", ") };
    // 監視用に明示ヘッダ (= synthetic test と CloudWatch Logs Insights で見る)
    response.headers["x-kochu-cdn"] = { value: "private-enforced" };
  }

  return response;
}
```

**deploy 手順 (AWS CLI)**:

```bash
# 1. Function を作成 (= LIVE stage まで publish)
aws cloudfront create-function \
  --name enforce-private-cache \
  --function-config Comment="SDUI private path enforcement",Runtime=cloudfront-js-2.0 \
  --function-code fileb://enforce-private-cache.cf2.js

aws cloudfront publish-function \
  --name enforce-private-cache \
  --if-match <ETag from create-function>

# 2. Distribution の Behavior `/api/v1/*` に associate
#    Console で行う場合: Behavior 編集 → Function associations → Viewer response → enforce-private-cache
#    CLI で行う場合は get-distribution-config → 編集 → update-distribution
```

### 5.2 (任意) `validate-session-cookie` (Viewer Request)

CloudFront に到達した時点で **session cookie が無いリクエストを 401 で即返す** ような前段防衛も入れられる (= origin の負荷削減)。実装は §7 残タスクで Phase 9+ に倒す。

## 6. AWS WAF (補助防衛)

### 6.1 推奨ルール

CloudFront に AWS WAF Web ACL を associate し、以下のルールを追加:

1. **Rate limit on `/api/v1/cart*` / `/api/v1/checkout*`**
   - IP 単位で 5 分間 100 リクエスト超 → BLOCK
   - 嫌がらせ / cart token 列挙攻撃を防ぐ

2. **Bot Control (Managed Rule)**
   - `AWSManagedRulesBotControlRuleSet` で `/api/v1/cards/cart` への bot アクセスを CHALLENGE
   - cart 中身の漏洩リスクは無いが、空のセッションが大量に作られる事故を防止

3. **Origin bypass の拒否** (= 重要)
   - origin (ALB) を CloudFront 経由でしか叩けないように、ALB Security Group に **CloudFront 用 prefix list** (`AWS::CloudFront::ManagedPrefixList`) からの inbound のみ許可
   - これにより CloudFront を回避して直接 ALB を叩く経路を物理的に塞ぐ
   - 加えて、ALB Listener Rule で `X-Kochu-Cf-Secret` カスタムヘッダ検証を行い、CloudFront から付与した secret 値と一致しなければ 403。CloudFront Origin Custom Headers でこの secret を設定。

## 7. CI 検証 (synthetic test)

deploy 後の edge 動作を CI から監視するため、以下の synthetic test を `scripts/check-cdn-headers.sh` に置く想定:

```bash
#!/usr/bin/env bash
# scripts/check-cdn-headers.sh — CloudFront edge レスポンスヘッダを assert (M9)
set -euo pipefail

EDGE_HOST="${EDGE_HOST:-https://kochu.example}"

PRIVATE_PATHS=(
  /api/v1/cards/cart
  /api/v1/checkout
  /api/v1/events
  /api/v1/watch/DHH-0271
)

PUBLIC_PATHS=(
  /api/v1/cards/products
  /health
)

echo "── private path: Cache-Control が private/no-store であること ──"
for path in "${PRIVATE_PATHS[@]}"; do
  cc=$(curl -sI "${EDGE_HOST}${path}" | grep -i '^cache-control:' | head -1 | tr -d '\r')
  cf=$(curl -sI "${EDGE_HOST}${path}" | grep -i '^x-kochu-cdn:' | head -1 | tr -d '\r')
  if ! echo "$cc" | grep -qiE 'private|no-store'; then
    echo "❌ $path: Cache-Control should be private/no-store but got: $cc"
    exit 1
  fi
  if ! echo "$cf" | grep -qi 'private-enforced'; then
    echo "❌ $path: x-kochu-cdn should be 'private-enforced' but got: $cf"
    exit 1
  fi
  echo "✓ $path: $cc / $cf"
done

echo ""
echo "── public path: x-cache が CloudFront から来ていること ──"
for path in "${PUBLIC_PATHS[@]}"; do
  xc=$(curl -sI "${EDGE_HOST}${path}" | grep -i '^x-cache:' | head -1 | tr -d '\r')
  if [ -z "$xc" ]; then
    echo "❌ $path: x-cache header missing (CloudFront 経由していない可能性)"
    exit 1
  fi
  echo "✓ $path: $xc"
done

echo ""
echo "✓ all CDN headers OK"
```

`EDGE_HOST` を staging / production で切り替え、CI workflow から定期実行 (= deploy 後 + nightly)。

## 8. lint: Rust source への新 endpoint 追加検出

新しい認証必須 endpoint を `server/src/routes.rs` に追加した PR で本ドキュメント追記漏れを検出する仕組みを `client_solid/scripts/check-cdn-paths.mjs` に置く想定:

```javascript
// 概要のみ (実装は Phase 9):
//   1. server/src/routes.rs から POST/PATCH/DELETE で session 必要な path を抽出
//   2. このドキュメントの "## 2. 対象 path 一覧" のコードブロックと diff
//   3. 不一致 (= 設計書追記漏れ or routes 削除後のゴミ) なら CI fail
//
// `npm run check:cdn-paths` で実行 / pre-commit hook にも登録。
```

## 9. 監視 / アラート (CloudWatch / X-Ray)

deploy 後の運用観点で、以下のメトリクスを CloudWatch ダッシュボードと CloudWatch Alarm に乗せる:

### 9.1 必須メトリクス

| メトリクス | 取得方法 | 閾値 |
|---|---|---|
| private path で `x-cache: Hit from cloudfront` が返った件数 | CloudFront access logs → Athena クエリ | **0 が正常 / 1 件でもアラート** |
| private path のレスポンス `Cache-Control` に `public` が含まれる件数 | CloudFront real-time logs → Kinesis → Lambda | **0 が正常** |
| private path への request で Cookie ヘッダが空のリクエスト件数 | ALB access logs → Athena | 急増で異常検知 (= 認証スキップの兆候) |
| WAF rate limit BLOCK 件数 (cart/checkout) | WAF metrics | 急増でアラート (= 攻撃の兆候) |
| CloudFront Function `enforce-private-cache` の execution errors | CloudWatch Metrics (`FunctionThrottles` / `FunctionExecutionErrors`) | **0 が正常 / 即アラート** |

### 9.2 ダッシュボード構成

CloudWatch Dashboard に以下のウィジェットを並べる:
1. CloudFront cache hit rate (private path で 0%、public path で 90%+ が正常)
2. ALB origin request count (private path のみ; public は CloudFront でほぼ吸収)
3. WAF Allow / Block ratio
4. CloudFront Function metrics (executions / errors / compute time)
5. private path Cache-Control 違反 (= §9.1 の Athena クエリ結果)

アラート通知は SNS → Slack / PagerDuty に流す。

## 10. 残タスク (Phase 9 着手時に解消)

| # | 内容 | 担当 | 想定スコープ |
|---|---|---|---|
| 1 | CloudFront Distribution 本番作成 (Terraform / CDK) | infra | 1d |
| 2 | Origin = ALB の構築 (ECS Fargate or EC2 with axum) | infra | 1d |
| 3 | CloudFront Function `enforce-private-cache` の deploy + Behavior associate | infra | 0.5d |
| 4 | AWS WAF Web ACL 設定 (rate limit / bot control / managed rules) | infra | 0.5d |
| 5 | ALB SG を CloudFront prefix list に絞る + custom header 認証 | infra | 0.5d |
| 6 | `scripts/check-cdn-headers.sh` を CI workflow (GitHub Actions) に組み込み | infra + CI | 0.5d |
| 7 | `scripts/check-cdn-paths.mjs` (routes.rs ↔ docs lint) を実装 | server + CI | 0.5d |
| 8 | CloudWatch Dashboard + Alarm 設定 | observability | 1d |
| 9 | 本ドキュメント `## 11. 本番設定` を上記 1-8 の確定値で展開 | infra | 0.5d |

## 11. 設計書との対応

| 設計書 | 内容 | 本ドキュメント |
| §14.3 | `Cache-Control: no-store` + `Vary: Cookie, Authorization` | §4.2, §5.1 (CloudFront Function 強制上書き) |
| §14.5 | path-level 物理遮断方針 | §1, §2, §4.1 (Behavior 分離 + デフォルト bypass) |
| §16 (Non-Goals) | 認証必須 endpoint を共有 CDN allowlist に含めない | §3, §4.1 (Behavior #0 で CachingDisabled 強制) |

## 12. IaC 雛形

### 12.1 AWS CDK (TypeScript)

```typescript
import * as cdk from "aws-cdk-lib";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

export class KochuCdnStack extends cdk.Stack {
  // CloudFront Function (Viewer Response)
  // const fn = new cf.Function(this, 'EnforcePrivateCache', {
  //   code: cf.FunctionCode.fromFile({ filePath: 'cloudfront-functions/enforce-private-cache.cf2.js' }),
  //   runtime: cf.FunctionRuntime.JS_2_0,
  // });
  //
  // Distribution の additionalBehaviors['/api/v1/*'] に
  //   cachePolicy: cf.CachePolicy.CACHING_DISABLED,
  //   originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
  //   responseHeadersPolicy: privateHeadersPolicy,
  //   functionAssociations: [{ function: fn, eventType: cf.FunctionEventType.VIEWER_RESPONSE }]
  // を associate。defaultBehavior は S3Origin で CACHING_OPTIMIZED。
}
```

### 12.2 Terraform (HCL)

```hcl
resource "aws_cloudfront_function" "enforce_private_cache" {
  name    = "enforce-private-cache"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/cloudfront-functions/enforce-private-cache.cf2.js")
}

resource "aws_cloudfront_response_headers_policy" "sdui_private" {
  name = "sdui-private-headers"
  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "private, no-store, max-age=0"
      override = true
    }
    items {
      header   = "Vary"
      value    = "Cookie, Authorization"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "kochu" {
  ordered_cache_behavior {
    path_pattern               = "/api/v1/*"
    target_origin_id           = aws_lb.kochu_alb.arn
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.sdui_private.id

    function_association {
      event_type   = "viewer-response"
      function_arn = aws_cloudfront_function.enforce_private_cache.arn
    }
  }
  web_acl_id = aws_wafv2_web_acl.kochu.arn
}
```

CDK / Terraform どちらで書くかは Phase 9 着手時に既存 IaC 状況に合わせて判断。
