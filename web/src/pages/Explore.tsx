import { useParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { useCatalog } from "../lib/data";

export default function Explore() {
  const { name } = useParams();
  const { t, pick } = useI18n();
  const { data: catalog } = useCatalog();
  const entry = catalog?.objects.find((object) => object.name === name);
  return (
    <div className="page-head">
      <h1>{entry ? pick(entry.title) : name}</h1>
      <p className="notice">{t("common.comingSoon")}</p>
    </div>
  );
}
