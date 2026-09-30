---
navigation: false
---

# Документация amxts

Документация amxts в виде обычного Markdown; на сайте она по адресу
[amxts.github.io/ru/docs](https://amxts.github.io/ru/docs). Сам сайт —
[amxts/amxts.github.io](https://github.com/amxts/amxts.github.io): он читает
эту папку как есть.

- `en/` — страницы на английском, `ru/` — те же страницы на русском.
  Пронумерованная папка — группа в боковом меню, пронумерованный файл —
  страница в ней; номера задают порядок и в адрес не входят
  (`ru/2.core/01.plugin.md` — это `/ru/docs/core/plugin`, `en/...` —
  `/docs/...`). В `.navigation.yml` папки — название группы и значок, во
  front matter страницы — её `title` и, если в меню она называется короче,
  `navigation.title`.
- `modules/en/`, `modules/ru/` — страница об официальном модуле; она
  показывается на его странице в каталоге модулей (`modules/ru/menu-core.md` —
  это `/ru/modules/menu-core`), если в собственном репозитории модуля нет README:
  иначе показывается README.

Ссылки между страницами — относительные ссылки на файлы `.md`, поэтому они
работают и здесь; сайт превращает их в свои адреса.

[English](README.md)
