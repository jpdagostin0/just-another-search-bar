/* prefs.js — SPDX-License-Identifier: GPL-2.0-or-later */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

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

        const misc = new Adw.PreferencesGroup({ title: 'Desktop' });
        const sw = new Adw.SwitchRow({
            title: 'Hide workspace switcher popup',
            subtitle: 'No indicator at the bottom of the screen when switching workspaces',
        });
        settings.bind('hide-workspace-popup', sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        misc.add(sw);
        page.add(misc);
        window.add(page);
    }
}
