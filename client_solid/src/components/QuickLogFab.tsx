// QuickLogFab.tsx — モバイル専用の固定 FAB
// App.tsx に配置され、どの画面からでもログ追加シートを開く。
// 表示は CSS (`.log-fab`) で @media (max-width: 640px) のときのみ。
import { Icons } from "./Icons";

interface QuickLogFabProps {
  onClick: () => void;
  /** 下部タブバー分の retract 位置計算 (default 76px) */
}

export const QuickLogFab = (p: QuickLogFabProps) => {
  return (
    <button
      type="button"
      class="log-fab"
      aria-label="ログを追加"
      onClick={p.onClick}
    >
      <span class="log-fab-ico" aria-hidden="true">
        {Icons.plus()}
      </span>
    </button>
  );
};
