# Launcher Bar

dmenu-style application launcher embedded in the GNOME top bar (fork of
[Just Another Search Bar](https://github.com/xelad0m/just-another-search-bar)).

Hidden until you press `Alt+P`. A plain text box then fills the free space of
the top bar (from the end of the left section to the next section) and matching
applications are listed inline.

| Key | Action |
|---|---|
| `Enter` | launch selected app (runs the text as a command if nothing matches) |
| `Ctrl+Enter` | new window of the selected app |
| `Tab` / `Down` / `Ctrl+N` / `Right` at end | next match |
| `Shift+Tab` / `Up` / `Ctrl+P` / `Left` at start | previous match |
| `Esc` / click elsewhere | close |

It also hides the workspace switcher popup (the indicator at the bottom of the
screen when changing workspaces); toggle with the `hide-workspace-popup` key or
in the extension settings.

Change the shortcut:

    gsettings --schemadir ~/.local/share/gnome-shell/extensions/just-another-search-bar@jpdagostin0/schemas \
      set org.gnome.shell.extensions.just-another-search-bar open-search-bar-key "['<Alt>p']"

Install: `make install`, then log out and back in (Wayland) and enable
`just-another-search-bar@jpdagostin0`.

License: GPL-2.0-or-later.
