import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export function NotFound() {
  const { lang, t } = useI18n();
  return (
    <div className="page-head">
      <h1>404</h1>
      <p className="lede">
        <Link to={`/${lang}`}>{t("nav.overview")}</Link>
      </p>
    </div>
  );
}
