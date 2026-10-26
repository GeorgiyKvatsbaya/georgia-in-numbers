import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n, type Lang } from "../i18n";

const REPO = "https://github.com/GeorgiyKvatsbaya/georgia-in-numbers";
const GEOSTAT = "https://www.geostat.ge/";

function Content({ lang }: { lang: Lang }): ReactNode {
  const data = <Link to={`/${lang}/data`}>{lang === "ru" ? "Данные" : lang === "ka" ? "მონაცემები" : "Data"}</Link>;
  if (lang === "ka") {
    return (
      <>
        <p>
          „საქართველო ციფრებში“ არის ღია, არაკომერციული პროექტი, რომელიც საქართველოს სტატისტიკის ეროვნული
          სამსახურის (საქსტატი) ოფიციალურ მონაცემებს გასაგებ გრაფიკებად და მარტივად ჩამოსატვირთ ფაილებად აქცევს.
        </p>
        <p className="notice">
          ეს არის <strong>არაოფიციალური</strong> პროექტი. ის არ არის დაკავშირებული საქსტატთან და არ არის მის მიერ
          მოწონებული. ოფიციალური მონაცემებისთვის იხილეთ <a href={GEOSTAT}>geostat.ge</a>.
        </p>
        <h2>საიდან მოდის მონაცემები</h2>
        <p>
          ყველა რიცხვი მიღებულია საქსტატის საჯარო PXWeb API-დან. მონაცემები ავტომატურად ახლდება ყოველ კვირას;
          ყოველ გრაფიკთან მითითებულია წყარო და მიღების თარიღი. თითოეული ცხრილი შეგიძლიათ ჩამოტვირთოთ გვერდზე „{data}“.
        </p>
        <h2>განმარტებები</h2>
        <ul>
          <li><strong>ნომინალური და რეალური ხელფასი.</strong> რეალური ხელფასი არის ნომინალური ხელფასი, გაყოფილი სამომხმარებლო ფასების ინდექსზე (2010 = 100) იმავე პერიოდისთვის.</li>
          <li><strong>წლიური და კვარტალური ხელფასი.</strong> საქსტატის წლიური ხელფასი სხვა მეთოდით ითვლება და 3–5%-ით დაბალია კვარტლების საშუალოზე, ამიტომ მათ ერთ რიგში არ ვურევთ.</li>
          <li><strong>წინასწარი მონაცემები.</strong> ეროვნული ანგარიშების ბოლო პერიოდები წინასწარია და შეიძლება გადაიხედოს.</li>
          <li><strong>ვაჭრობა.</strong> საგარეო ვაჭრობის ცხრილები API-ზე 2020 წლით სრულდება, ამიტომ ექსპორტსა და იმპორტს ვაჩვენებთ ეროვნული ანგარიშებიდან.</li>
        </ul>
        <h2>ღია კოდი</h2>
        <p>პროექტის კოდი ღიაა: <a href={REPO}>GitHub</a>. შენიშვნები და შეცდომები გამოგვიგზავნეთ issue-ს სახით.</p>
        <h2>ლიცენზია და მითითება</h2>
        <p>მონაცემების წყარო: საქართველოს სტატისტიკის ეროვნული სამსახური (საქსტატი). საქსტატი ნებას რთავს მონაცემების ხელახლა გამოყენებას წყაროს მითითებით.</p>
      </>
    );
  }
  if (lang === "ru") {
    return (
      <>
        <p>
          «Грузия в цифрах» — открытый некоммерческий проект, который превращает официальные данные Национальной
          службы статистики Грузии (Сакстат) в понятные графики и удобные для выгрузки файлы.
        </p>
        <p className="notice">
          Это <strong>неофициальный</strong> проект. Он не связан с Сакстатом и не одобрен им. Официальные данные —
          на сайте <a href={GEOSTAT}>geostat.ge</a>.
        </p>
        <h2>Откуда данные</h2>
        <p>
          Все цифры получены через публичный PXWeb API Сакстата. Данные обновляются автоматически раз в неделю; у
          каждого графика указан источник и дата получения. Любую таблицу можно скачать в разделе «{data}».
        </p>
        <h2>Определения</h2>
        <ul>
          <li><strong>Номинальная и реальная зарплата.</strong> Реальная зарплата — номинальная, делённая на индекс потребительских цен (2010 = 100) за тот же период.</li>
          <li><strong>Годовая и квартальная зарплата.</strong> Годовую зарплату Сакстат рассчитывает иначе: она на 3–5% ниже среднего по кварталам, поэтому мы не смешиваем их в одном ряду.</li>
          <li><strong>Предварительные данные.</strong> Последние периоды национальных счетов предварительные и могут пересматриваться.</li>
          <li><strong>Торговля.</strong> Таблицы внешней торговли в API заканчиваются 2020 годом, поэтому экспорт и импорт мы показываем по данным национальных счетов.</li>
        </ul>
        <h2>Открытый код</h2>
        <p>Код проекта открыт: <a href={REPO}>GitHub</a>. Замечания и ошибки присылайте через issues.</p>
        <h2>Лицензия и ссылка на источник</h2>
        <p>Источник данных: Национальная служба статистики Грузии (Сакстат). Сакстат разрешает повторное использование данных со ссылкой на источник.</p>
      </>
    );
  }
  return (
    <>
      <p>
        Georgia in Numbers is an open, non-commercial project that turns official data from the National Statistics
        Office of Georgia (Geostat) into clear charts and easy-to-download files.
      </p>
      <p className="notice">
        This is an <strong>unofficial</strong> project. It is not affiliated with or endorsed by Geostat. For official
        figures, see <a href={GEOSTAT}>geostat.ge</a>.
      </p>
      <h2>Where the data comes from</h2>
      <p>
        Every number is read from Geostat's public PXWeb API. The data refreshes automatically every week, and every
        chart shows its source and retrieval date. You can download each table on the {data} page.
      </p>
      <h2>Definitions</h2>
      <ul>
        <li><strong>Nominal vs real wages.</strong> Real wages are nominal wages divided by the consumer price index (2010 = 100) for the same period.</li>
        <li><strong>Annual vs quarterly wages.</strong> Geostat compiles the annual salary differently; it runs 3–5% below the average of the quarters, so the two are never mixed in one series.</li>
        <li><strong>Preliminary figures.</strong> The latest national-accounts periods are preliminary and may be revised.</li>
        <li><strong>Trade.</strong> External-trade tables on the API end in 2020, so exports and imports come from the national accounts.</li>
      </ul>
      <h2>Open source</h2>
      <p>The code is open on <a href={REPO}>GitHub</a>. Please report problems or ideas as issues.</p>
      <h2>Licence and attribution</h2>
      <p>Data source: National Statistics Office of Georgia (Geostat). Geostat permits reuse of its published statistics with attribution.</p>
    </>
  );
}

export function About() {
  const { lang, t } = useI18n();
  return (
    <article className="prose">
      <h1>{t("about.title")}</h1>
      <Content lang={lang} />
    </article>
  );
}
