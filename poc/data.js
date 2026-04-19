// data.js — mock data for 昆虫アプリ prototype

window.APP_DATA = {
  user: {
    name: "山田 徹",
    handle: "t_yamada",
    role: "BREEDER · LV.3",
    initial: "山",
    since: "2024.03"
  },

  species: [
    { id: "dhh", ja: "ヘラクレスオオカブト", sci: "Dynastes hercules hercules", region: "中南米" },
    { id: "cat", ja: "コーカサスオオカブト", sci: "Chalcosoma chiron", region: "東南アジア" },
    { id: "aki", ja: "アクタエオンゾウカブト", sci: "Megasoma actaeon", region: "南米" },
    { id: "nat", ja: "国産カブトムシ", sci: "Trypoxylus dichotomus", region: "日本" },
    { id: "neo", ja: "ネプチューンオオカブト", sci: "Dynastes neptunus", region: "南米" }
  ],

  specimens: [
    {
      id: "#DHH-0271",
      name: "ヘラクレス 黒曜",
      species: "ヘラクレスオオカブト",
      sci: "Dynastes hercules hercules",
      sex: "♂",
      stage: "蛹",
      stageProgress: 0.72,
      sizeMm: 142,
      weightG: 28.4,
      birthDate: "2024-08-12",
      purchasedAt: "2025-11-03",
      shop: "ANCHOR BEETLE CO.",
      generation: "CBF2",
      price: 48000,
      eclosionETA: "2026-05-04",
      eclosionInDays: 15,
      status: "alive",
      bloodline: { father: "#DHH-0213", mother: "#DHH-0244" },
      notes: "羽化ズレ注意。温度22℃キープ。"
    },
    {
      id: "#DHH-0244",
      name: "マリア",
      species: "ヘラクレスオオカブト",
      sci: "Dynastes hercules hercules",
      sex: "♀",
      stage: "成虫",
      stageProgress: 1,
      sizeMm: 66,
      weightG: 12.1,
      birthDate: "2023-06-20",
      purchasedAt: "2024-05-01",
      shop: "ANCHOR BEETLE CO.",
      generation: "CBF1",
      price: 22000,
      eclosionETA: null,
      eclosionInDays: null,
      status: "alive",
      bloodline: { father: "WILD", mother: "WILD" }
    },
    {
      id: "#CAT-0118",
      name: "コーカサス 雷",
      species: "コーカサスオオカブト",
      sci: "Chalcosoma chiron",
      sex: "♂",
      stage: "幼虫 3齢",
      stageProgress: 0.35,
      sizeMm: 95,
      weightG: 52.0,
      birthDate: "2025-09-01",
      purchasedAt: "2026-01-12",
      shop: "ANCHOR BEETLE CO.",
      generation: "CBF3",
      price: 12000,
      eclosionETA: "2026-11-20",
      eclosionInDays: 215,
      status: "alive",
      bloodline: { father: "#CAT-0091", mother: "#CAT-0097" }
    },
    {
      id: "#NAT-0402",
      name: "国産 小次郎",
      species: "国産カブトムシ",
      sci: "Trypoxylus dichotomus",
      sex: "♂",
      stage: "前蛹",
      stageProgress: 0.88,
      sizeMm: 78,
      weightG: 22.3,
      birthDate: "2025-07-15",
      purchasedAt: "2025-10-02",
      shop: "ANCHOR BEETLE CO.",
      generation: "CBF4",
      price: 3800,
      eclosionETA: "2026-05-22",
      eclosionInDays: 33,
      status: "alive",
      bloodline: { father: "#NAT-0341", mother: "#NAT-0355" }
    },
    {
      id: "#NEO-0058",
      name: "ネプチューン 青嵐",
      species: "ネプチューンオオカブト",
      sci: "Dynastes neptunus",
      sex: "♂",
      stage: "幼虫 3齢",
      stageProgress: 0.42,
      sizeMm: 102,
      weightG: 68.5,
      birthDate: "2025-06-18",
      purchasedAt: "2025-12-20",
      shop: "MIYAMA FARM",
      generation: "CBF2",
      price: 28000,
      eclosionETA: "2026-08-30",
      eclosionInDays: 133,
      status: "alive",
      bloodline: { father: "#NEO-0041", mother: "#NEO-0044" }
    },
    {
      id: "#AKI-0012",
      name: "アクタエオン 漆黒",
      species: "アクタエオンゾウカブト",
      sci: "Megasoma actaeon",
      sex: "♂",
      stage: "幼虫 3齢",
      stageProgress: 0.25,
      sizeMm: 88,
      weightG: 110.0,
      birthDate: "2025-04-10",
      purchasedAt: "2025-09-08",
      shop: "MIYAMA FARM",
      generation: "WF1",
      price: 62000,
      eclosionETA: "2027-02-15",
      eclosionInDays: 668,
      status: "alive",
      bloodline: { father: "WILD", mother: "WILD" }
    }
  ],

  products: [
    {
      id: "p-hh-m-142",
      kind: "生体",
      title: "ヘラクレスオオカブト ♂ 142mm",
      sci: "Dynastes hercules hercules",
      price: 48000,
      badge: "血統書付",
      generation: "CBF2",
      shop: "ANCHOR BEETLE CO.",
      tone: "forest",
      phLabel: "ヘラクレス 個体写真"
    },
    {
      id: "p-cat-l",
      kind: "生体",
      title: "コーカサス幼虫 3齢 ♂ 52g",
      sci: "Chalcosoma chiron",
      price: 12000,
      badge: "CBF3",
      generation: "CBF3",
      shop: "ANCHOR BEETLE CO.",
      tone: "forest",
      phLabel: "コーカサス幼虫写真"
    },
    {
      id: "p-neo-m",
      kind: "生体",
      title: "ネプチューン ♂ 初令ペア",
      sci: "Dynastes neptunus",
      price: 28000,
      badge: "ペア割",
      generation: "CBF2",
      shop: "MIYAMA FARM",
      tone: "forest",
      phLabel: "ネプチューン 個体写真"
    },
    {
      id: "p-aki",
      kind: "生体",
      title: "アクタエオン WILD F1 ♂",
      sci: "Megasoma actaeon",
      price: 62000,
      badge: "WF1",
      generation: "WF1",
      shop: "MIYAMA FARM",
      tone: "forest",
      phLabel: "アクタエオン 個体写真"
    },
    {
      id: "p-jelly",
      kind: "用品",
      title: "高栄養ゼリー 17g × 50個",
      sci: null,
      price: 1480,
      badge: "在庫 320",
      generation: null,
      shop: "ANCHOR BEETLE CO.",
      tone: "amber",
      phLabel: "ゼリーパック"
    },
    {
      id: "p-mat",
      kind: "用品",
      title: "完熟発酵マット 10L",
      sci: null,
      price: 1280,
      badge: "在庫 88",
      generation: null,
      shop: "ANCHOR BEETLE CO.",
      tone: "amber",
      phLabel: "発酵マット"
    }
  ],

  logs: [
    { date: "2026-04-18", time: "21:40", type: "observation", title: "蛹室確認", body: "蛹室の壁が硬くなった。羽化まで2週間程度か。", photo: true, specimen: "#DHH-0271" },
    { date: "2026-04-17", time: "08:15", type: "feed", title: "ゼリー交換", body: "16g × 2 / 食痕多し", photo: false, specimen: "#DHH-0244" },
    { date: "2026-04-15", time: "22:03", type: "weight", title: "体重測定", body: "52.0g → 52.8g (+0.8g)", photo: true, specimen: "#CAT-0118" },
    { date: "2026-04-14", time: "19:20", type: "molt", title: "脱皮確認", body: "3齢初期。頭幅 14mm。", photo: true, specimen: "#CAT-0118" },
    { date: "2026-04-12", time: "10:45", type: "mat", title: "マット交換", body: "5L 投入。premium黒土ブレンド。", photo: false, specimen: "#NEO-0058" },
    { date: "2026-04-10", time: "23:11", type: "observation", title: "前蛹化", body: "体色黄化。姿勢変化。", photo: true, specimen: "#NAT-0402" },
    { date: "2026-04-08", time: "07:30", type: "weight", title: "体重測定", body: "108g → 110g (+2g)", photo: false, specimen: "#AKI-0012" },
    { date: "2026-04-05", time: "21:00", type: "feed", title: "ゼリー交換", body: "17g × 4", photo: false, specimen: "#DHH-0244" },
    { date: "2026-04-03", time: "14:30", type: "observation", title: "蛹化確認", body: "前蛹→蛹。全長約125mm。", photo: true, specimen: "#DHH-0271" },
    { date: "2026-03-28", time: "19:00", type: "mat", title: "菌糸ビン交換", body: "1400cc → 2300cc", photo: false, specimen: "#CAT-0118" }
  ],

  shopStats: {
    todayRevenue: 184200,
    todayOrders: 12,
    pendingShip: 5,
    lowStock: 3,
    mau: 2340,
    revenue7d: [62000, 48000, 91000, 73000, 124000, 102000, 184200]
  },

  orders: [
    { id: "#2026-04180-A", buyer: "田中 亮", items: "ヘラクレス♂142 他1点", total: 48980, status: "要発送", temp: "要温度制御" },
    { id: "#2026-04179-B", buyer: "佐藤 恵", items: "コーカサス幼虫×2", total: 24000, status: "発送済", temp: "常温" },
    { id: "#2026-04178-C", buyer: "鈴木 駿", items: "ゼリー×3 マット×2", total: 6960, status: "発送済", temp: "常温" },
    { id: "#2026-04177-D", buyer: "高橋 花", items: "ネプチューン ペア", total: 28000, status: "準備中", temp: "要温度制御" },
    { id: "#2026-04176-E", buyer: "伊藤 翔", items: "アクタエオン WF1♂", total: 62000, status: "入金待ち", temp: "要温度制御" }
  ],

  listings: [
    { id: "L-0421", title: "ヘラクレス♂ 148mm 自家累代CBF3", seller: "山田 徹", price: 52000, bids: 7, watchers: 34, endsIn: "2日 14h", auction: true, verified: true },
    { id: "L-0419", title: "コーカサス幼虫 3齢ペア 55g/32g", seller: "KUWAGATA.jp", price: 18000, bids: null, watchers: 12, endsIn: "即決のみ", auction: false, verified: true },
    { id: "L-0418", title: "国産 自家累代CBF5 ♂ 82mm", seller: "natmori", price: 4800, bids: 3, watchers: 22, endsIn: "18h", auction: true, verified: false },
    { id: "L-0416", title: "ネプチューン ♂ 成虫 135mm", seller: "miyama_farm", price: 38000, bids: 11, watchers: 68, endsIn: "4h 32m", auction: true, verified: true }
  ]
};
