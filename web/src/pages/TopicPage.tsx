import type { Topic } from "../components/Layout";
import { useI18n, type MessageKey } from "../i18n";

export function TopicPage({ topic }: { topic: Topic }) {
  const { t } = useI18n();
  return (
    <div className="page-head">
      <h1>{t(`nav.${topic}` as MessageKey)}</h1>
      <p className="lede">{t(`topic.${topic}` as MessageKey)}</p>
      <p className="notice">{t("common.comingSoon")}</p>
    </div>
  );
}
