// components/cohort/CohortStatusBadge.tsx — アクティブ / アーカイブの状態 badge
//
// archivedAt の有無で表示分岐:
//   - active: forest 系 chip「アクティブ」
//   - archived: mute 系 chip「アーカイブ済み」

import { Show } from "solid-js";

interface Props {
  archivedAt: string | null;
}

export const CohortStatusBadge = (props: Props) => (
  <Show
    when={props.archivedAt}
    fallback={<span class="chip chip-forest">アクティブ</span>}
  >
    <span class="chip chip-mute">アーカイブ済み</span>
  </Show>
);
