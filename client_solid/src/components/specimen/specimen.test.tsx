// specimen.test.tsx — components/specimen/* のレンダリングテスト
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import type { LogEntry, Specimen } from "../../api";
import { LogList } from "./LogList";
import { LogTypeTag } from "./LogTypeTag";
import { SpecDL } from "./SpecDL";
import { StageBar } from "./StageBar";

const FAKE_SPECIMEN: Specimen = {
  id: "#TEST-0001",
  name: "テスト個体",
  species: "ヘラクレスオオカブト",
  sci: "Dynastes hercules hercules",
  sex: "♂",
  sizeMm: 142,
  weightG: 28.4,
  generation: "CBF2",
  birthDate: "2025-09-01",
  purchasedAt: "2025-05-14",
  shop: "ANCHOR BEETLE CO.",
  price: 48000,
  stage: "成虫",
  stageProgress: 100,
  eclosionETA: null,
  eclosionInDays: null,
  status: "飼育中",
  bloodline: { father: "#DHH-0100", mother: "#DHH-0101" },
};

const FAKE_LOGS: LogEntry[] = [
  {
    date: "2025-10-12",
    time: "09:30",
    type: "weight",
    title: "体重計測",
    body: "28.4g（先週比 +1.1g）",
    specimen: "#TEST-0001",
    photo: false,
  },
  {
    date: "2025-10-11",
    time: "22:15",
    type: "molt",
    title: "脱皮観察",
    body: "無事に成虫化",
    specimen: "#TEST-0001",
    photo: true,
  },
];

describe("LogTypeTag", () => {
  it("renders a chip with Japanese label per log type", () => {
    const cases = [
      { type: "weight" as const, label: "体重" },
      { type: "feed" as const, label: "給餌" },
      { type: "mat" as const, label: "マット" },
      { type: "molt" as const, label: "脱皮" },
      { type: "observation" as const, label: "観察" },
    ];
    for (const { type, label } of cases) {
      const { container, unmount } = render(() => <LogTypeTag type={type} />);
      expect(container.textContent).toContain(label);
      unmount();
    }
  });
});

describe("SpecDL", () => {
  it("renders all specimen key/value rows", () => {
    const { container } = render(() => <SpecDL s={FAKE_SPECIMEN} />);
    const text = container.textContent ?? "";
    expect(text).toContain("種");
    expect(text).toContain("ヘラクレスオオカブト");
    expect(text).toContain("性別");
    expect(text).toContain("♂");
    expect(text).toContain("サイズ");
    expect(text).toContain("142 mm");
    expect(text).toContain("体重");
    expect(text).toContain("28.4 g");
    expect(text).toContain("累代");
    expect(text).toContain("CBF2");
    expect(text).toContain("ANCHOR BEETLE CO.");
  });
});

describe("LogList", () => {
  it("renders log entries with date, title, and body by default", () => {
    const { container } = render(() => <LogList logs={FAKE_LOGS} />);
    const text = container.textContent ?? "";
    expect(text).toContain("体重計測");
    expect(text).toContain("28.4g");
    expect(text).toContain("脱皮観察");
  });

  it("hides body when compact=true", () => {
    const { container } = render(() => <LogList logs={FAKE_LOGS} compact />);
    const text = container.textContent ?? "";
    expect(text).toContain("体重計測");
    expect(text).not.toContain("28.4g（先週比");
  });

  it("renders IMG placeholder only when log.photo is truthy", () => {
    const { container } = render(() => <LogList logs={FAKE_LOGS} />);
    // 2nd log has photo=true, 1st doesn't
    const imgPlaceholders = container.querySelectorAll(".ph");
    expect(imgPlaceholders.length).toBe(1);
  });

  it("renders no log rows when list is empty", () => {
    // 空配列なら row 数 (each log render) は 0、外側 div だけ残る
    const { container } = render(() => <LogList logs={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("StageBar", () => {
  it("renders horizontal stage bar with stage labels", () => {
    const { container } = render(() => (
      <StageBar stage="幼虫3齢" progress={45} eta={80} />
    ));
    const text = container.textContent ?? "";
    // Horizontal layout shows stage names
    expect(text).toContain("幼虫3齢");
  });

  it("renders vertical variant when vertical=true", () => {
    const { container } = render(() => (
      <StageBar stage="蛹" progress={90} eta={7} vertical />
    ));
    const text = container.textContent ?? "";
    // Vertical layout lists all 7 stages
    expect(text).toContain("卵");
    expect(text).toContain("成虫");
    expect(text).toContain("蛹");
  });
});
