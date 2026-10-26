import { useI18n } from "../i18n";

export default function Sql() {
  const { t } = useI18n();
  return (
    <div className="page-head">
      <h1>{t("home.sql.title")}</h1>
      <p className="lede">{t("home.sql.text")}</p>
      <p className="notice">{t("common.comingSoon")}</p>
    </div>
  );
}
