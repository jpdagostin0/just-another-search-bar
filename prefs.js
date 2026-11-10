/* prefs.js — SPDX-License-Identifier: GPL-2.0-or-later */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class LauncherBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Shortcut',
            description: 'GTK accelerator syntax, e.g. <Alt>p or <Super>space. Press Enter to apply.',
        });

        const row = new Adw.EntryRow({
            title: 'Open launcher',
            text: settings.get_strv('open-search-bar-key')[0] ?? '',
            show_apply_button: true,
        });
        row.connect('apply', () => {
            const accel = row.get_text().trim();
            const [ok] = Gtk.accelerator_parse(accel);
            if (accel === '' || ok) {
                settings.set_strv('open-search-bar-key', accel ? [accel] : []);
                row.remove_css_class('error');
            } else {
                row.add_css_class('error');
            }
        });

        group.add(row);
        page.add(group);
        window.add(page);
    }
}
