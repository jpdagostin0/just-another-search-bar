/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* Based on Google Search (https://extensions.gnome.org/extension/1057/google-search/)
 *
 * Fork: the search entry lives directly in the top bar (dmenu style) instead
 * of a popup menu. The shortcut grabs the keyboard and focuses the entry;
 * Enter runs the query, Escape / clicking elsewhere releases it, Tab and
 * Shift+Tab cycle the active search command, right-click opens preferences.
 */


import GObject from 'gi://GObject';
import St from 'gi://St';

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';


const ENTER_KEYS = [
    Clutter.KEY_Return,
    Clutter.KEY_KP_Enter,
    Clutter.KEY_ISO_Enter,
    Clutter.KEY_RockerEnter,
    Clutter.KEY_3270_Enter,
];

const KEYBINDING = 'open-search-bar-key';


function quoteFix(str) {
    return str.replaceAll("'", "%27")
              .replaceAll("\"", "%22")
              .replaceAll("`", "%60")
              .replaceAll("#", "%23")
              .replaceAll("&", "%26");
}


export default class SearchBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._createBar();

        this._settings.connectObject(
            `changed::${KEYBINDING}`, () => this._rebind(),
            'changed::panel-box',      () => this._recreateBar(),
            'changed::panel-index',    () => this._recreateBar(),
            this);

        this._bind();
    }

    disable() {
        Main.wm.removeKeybinding(KEYBINDING);
        this._settings?.disconnectObject(this);
        this._bar?.destroy();
        this._bar = null;
        this._settings = null;
    }

    _createBar() {
        this._bar = new PanelSearchBar(this._settings, () => this.openPreferences());
        const box = this._settings.get_string('panel-box');
        const index = this._settings.get_int('panel-index');
        Main.panel.addToStatusArea(this.uuid, this._bar,
            index < 0 ? 1000 : index,
            ['left', 'center', 'right'].includes(box) ? box : 'left');
    }

    _recreateBar() {
        this._bar?.destroy();
        this._createBar();
    }

    _bind() {
        Main.wm.addKeybinding(
            KEYBINDING,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._bar?.toggle());
    }

    _rebind() {
        Main.wm.removeKeybinding(KEYBINDING);
        this._bind();
    }
}


const PanelSearchBar = GObject.registerClass(
class PanelSearchBar extends PanelMenu.Button {

    _init(settings, openPrefs) {
        // dontCreateMenu = true: the entry itself is the whole UI
        super._init(0.0, 'Search Bar', true);
        this.add_style_class_name('jasb-panel-button');

        this._settings = settings;
        this._openPrefs = openPrefs;
        this._grab = null;
        this._capturedId = 0;
        this._busy = false;

        const box = new St.BoxLayout({
            style_class: 'jasb-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(box);

        this._label = new St.Label({
            style_class: 'jasb-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);

        this.entry = new St.Entry({
            style_class: 'jasb-entry',
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this.entry);

        const text = this.entry.clutter_text;
        text.connect('key-press-event', this._onKeyPress.bind(this));
        // Clicking into the text gives it stage focus: turn that into a grab
        text.connect('key-focus-in', () => {
            if (!this._grab && !this._busy) this.activate();
        });
        text.connect('key-focus-out', () => {
            if (this._grab && !this._busy) this.deactivate();
        });

        // Right-click anywhere on the bar opens preferences,
        // left-click on the label / padding focuses the entry.
        this.connect('captured-event', (_a, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const target = global.stage.get_event_actor(event);
            const inside = target && this.contains(target);
            if (this._grab && !inside) {      // click outside while grabbed
                this.deactivate();
                return Clutter.EVENT_STOP;
            }
            if (inside && event.get_button() === Clutter.BUTTON_SECONDARY) {
                this.deactivate();
                this._openPrefs();
                return Clutter.EVENT_STOP;
            }
            if (inside && !this._grab && !this.entry.contains(target)) {
                this.activate();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._settings.connectObject(
            'changed::command-id',    () => this._updateLabel(),
            'changed::command-names', () => this._updateLabel(),
            this);
        this._updateLabel();

        this.connect('destroy', () => {
            this.deactivate();
            this._settings.disconnectObject(this);
        });
    }

    // ── state ────────────────────────────────────────────
    toggle() {
        if (this._grab) this.deactivate();
        else this.activate();
    }

    activate() {
        if (this._grab || this._busy) return;
        this._busy = true;
        try {
            // clear first so popModal() never restores focus into the entry
            global.stage.set_key_focus(null);
            const grab = Main.pushModal(this, { actionMode: Shell.ActionMode.POPUP });
            if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
                Main.popModal(grab);
                return;
            }
            this._grab = grab;
            this.add_style_pseudo_class('active');
            this.entry.grab_key_focus();
        } finally {
            this._busy = false;
        }
    }

    deactivate() {
        if (!this._grab || this._busy) return;
        this._busy = true;
        try {
            const grab = this._grab;
            this._grab = null;
            this.entry.set_text('');
            this.remove_style_pseudo_class('active');
            global.stage.set_key_focus(null);
            Main.popModal(grab);
        } finally {
            this._busy = false;
        }
    }

    // ── events ───────────────────────────────────────────
    _onKeyPress(_actor, event) {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
            this.deactivate();
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab) {
            const back = symbol === Clutter.KEY_ISO_Left_Tab ||
                (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            this._cycleCommand(back ? -1 : 1);
            return Clutter.EVENT_STOP;
        }

        if (ENTER_KEYS.includes(symbol)) {
            const query = this.entry.get_text();
            this.deactivate();
            if (query.trim().length > 0)
                this._goSearch(query);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // ── commands ─────────────────────────────────────────
    _cycleCommand(step) {
        const n = this._settings.get_strv('command-names').length;
        if (n === 0) return;
        const cur = this._settings.get_int('command-id');
        this._settings.set_int('command-id', ((cur + step) % n + n) % n);
    }

    _updateLabel() {
        const names = this._settings.get_strv('command-names');
        const name = names[this._settings.get_int('command-id')] ?? '';
        this._label.set_text(name);
        this.entry.hint_text = name ? _('search') + '…' : '';
    }

    _compileCommand(template, wildcard, delimiter, query) {
        query = quoteFix(String(query).trim().replace(/ /g, String(delimiter)));
        return (wildcard != '') ? String(template).replace(String(wildcard), query)
                                : String(template) + ' ' + query;
    }

    _goSearch(query) {
        const cmdId = this._settings.get_int('command-id');
        const cmdName = this._settings.get_strv('command-names')[cmdId];
        const template = this._settings.get_strv('command-templates')[cmdId];
        const wildcard = this._settings.get_strv('command-wildcards')[cmdId];
        const delimiter = this._settings.get_strv('command-delimiters')[cmdId];

        if (template === undefined) return;

        const command = this._compileCommand(template, wildcard ?? '', delimiter ?? '+', query);
        try {
            GLib.spawn_command_line_async(command);
        } catch (e) {
            logError(e, `[ Search Bar ] [Error spawning command]: ${command}`);
            Main.notify(_("Can't open ") + `${cmdName} (${query})`);
        }
    }
});
