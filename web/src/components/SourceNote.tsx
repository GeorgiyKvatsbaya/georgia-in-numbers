import { useI18n } from "../i18n";
import { useCatalog } from "../lib/data";
import { formatDate } from "../lib/format";

/** "Source: Geostat · retrieved <date>" for the catalog objects a chart is built from. */
export function SourceNote({ objects }: { objects: string[] }) {
  const { lang, t } = useI18n();
  const { data: catalog } = useCatalog();
  const entries = catalog?.objects.filter((entry) => objects.includes(entry.name)) ?? [];
  const sources = entries.flatMap((entry) => entry.sources);
  const url = sources[0]?.web_url;
  const retrieved = sources.map((source) => source.retrieved_at).sort().at(-1);
  return (
    <p className="source-note">
      {t("common.source")}:{" "}
      {url ? (
        <a href={lang === "ka" ? url.replace("/pxweb/en/", "/pxweb/ka/") : url} target="_blank" rel="noreferrer">
          Geostat
        </a>
      ) : (
        "Geostat"
      )}
      {retrieved && ` · ${t("common.retrieved", { date: formatDate(lang, retrieved) })}`}
    </p>
  );
}
