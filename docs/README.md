---
navigation: false
---

# amxts documentation

The documentation of amxts in raw Markdown, served at
[amxts.github.io/docs](https://amxts.github.io/docs). The site itself is
[amxts/amxts.github.io](https://github.com/amxts/amxts.github.io): it reads
this folder as it is.

- `en/` - the pages in English, `ru/` - the same pages in Russian. A numbered
  folder is a group of the sidebar, a numbered file is a page in it; the
  numbers set the order and are not part of the address
  (`en/2.core/01.plugin.md` is `/docs/core/plugin`, `ru/...` is
  `/ru/docs/...`). A folder's `.navigation.yml` has the group's title and
  icon, a page's front matter has its `title` and, when the sidebar says it
  shorter, `navigation.title`.
- `modules/en/`, `modules/ru/` - a page about an official module, shown on
  the module's page in the modules catalog (`modules/en/menu-core.md` is
  `/modules/menu-core`), unless the module's own repository has a README: that
  takes its place.

Links between pages are relative links to the `.md` files, so they work here
too; the site turns them into its addresses.

[Русский](README.ru.md)
