# Zebra Label Designer for ERPNext

Lekki edytor etykiet Zebra działający jako strona w ERPNext/Frappe Desk. Pozwala
ustawić fizyczny rozmiar etykiety, układać tekst, prostokąty, elipsy, linie i
obrazy, a następnie wygenerować surowy strumień ZPL (`.prn`).

## Funkcje

- płótno SVG ze współrzędnymi i wymiarami w milimetrach,
- profile 203, 300 i 600 DPI,
- tekst, prostokąt, elipsa, linia oraz PNG/JPEG,
- przeciąganie, skalowanie, obrót co 90°, kolejność warstw i duplikowanie,
- siatka, przyciąganie, zoom, cofanie i ponawianie,
- konwersja obrazu do monochromatycznego `^GFA`,
- szablony tekstowe, np. `{{ doc.item_code }}` i dane podglądu JSON,
- zapis projektu w DocType `Zebra Label Template`,
- kopiowanie ZPL i pobieranie pliku `.prn`.

## Instalacja

Najprościej zainstalować aplikację w katalogu swojego `frappe-bench`.

Wariant z repozytorium Git lub lokalnego folderu obsługiwanego przez bench:

```bash
cd ~/frappe-bench
bench get-app file:///pełna/ścieżka/do/zebra_label_designer
bench --site twoja-strona.local install-app zebra_label_designer
bench build --app zebra_label_designer
bench --site twoja-strona.local migrate
bench restart
```

Wariant ręczny, jeżeli masz ZIP albo kopiujesz folder bezpośrednio na serwer:

```bash
cd ~/frappe-bench
unzip /pełna/ścieżka/do/zebra_label_designer-0.1.0.zip -d apps/
./env/bin/pip install -e apps/zebra_label_designer
grep -qxF zebra_label_designer sites/apps.txt || echo zebra_label_designer >> sites/apps.txt
bench --site twoja-strona.local install-app zebra_label_designer
bench build --app zebra_label_designer
bench --site twoja-strona.local migrate
bench restart
bench --site twoja-strona.local clear-cache
```

Jeżeli bench działa w Dockerze, wykonaj te same komendy wewnątrz kontenera
backend, np. `docker compose exec backend bench --site twoja-strona.local
install-app zebra_label_designer`.

Po instalacji w Desk otwórz stronę **Zebra Label Designer** z wyszukiwarki albo
przejdź pod adres `/app/zebra-label-designer`.

Szybki test po instalacji:

```bash
bench --site twoja-strona.local execute zebra_label_designer.api.list_templates
```

## Uprawnienia

Pełny dostęp ma rola `System Manager`. Użytkownicy z rolą `Stock User` mogą
tworzyć, odczytywać i edytować szablony. `Stock Manager` może je również usuwać.

## Wiązanie danych ERPNext

W elemencie tekstowym można użyć pól z dokumentu:

```text
Indeks: {{ doc.item_code }}
Partia: {{ doc.batch_no }}
```

Edytor korzysta z JSON-u danych podglądu. Z poziomu kodu serwera można pobrać
gotowe ZPL z rzeczywistym dokumentem przez:

```python
frappe.call(
    "zebra_label_designer.api.render_template",
    template="Etykieta produktu 100x50",
    document_name="ITEM-0001",
)
```

`source_doctype` zapisany w szablonie określa typ dokumentu. Metoda respektuje
uprawnienia odczytu użytkownika do tego dokumentu.

## Ważne informacje o drukowaniu

- aplikacja generuje ZPL i nie otwiera bezpośrednio połączenia sieciowego z
  drukarką,
- polskie znaki są wysyłane jako UTF-8 (`^CI28`); zgodność zależy od fontu i
  firmware drukarki,
- przed drukiem produkcyjnym sprawdź wynik na właściwym modelu Zebra,
- eksport obrazów działa w przeglądarce, dlatego zapisany projekt przechowuje
  obraz jako Data URL.

## Testy

```bash
node --test zebra_label_designer/tests/zpl_engine.test.js
python -m compileall zebra_label_designer
```

## Licencja

MIT
