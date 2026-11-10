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

/* Originally based on Google Search
 * (https://extensions.gnome.org/extension/1057/google-search/) via
 * Just Another Search Bar by xelad0m.
 *
 * Fork: dmenu-style application launcher living in the top bar. Hidden until
 * the shortcut is pressed; then a plain text box fills the free space of the
 * panel (from the end of the left section to the next section) with matching
 * applications listed inline.
 *
 *   Enter          launch selected app (or run the text as a command if
 *                  nothing matches)
 *   Ctrl+Enter     open a new window of the selected app
 *   Tab / Down / Ctrl+N / Right(at end)       next match
 *   Shift+Tab / Up / Ctrl+P / Left(at start)  previous match
 *   Esc / click elsewhere                     close
 */


import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


const ENTER_KEYS = [
    Clutter.KEY_Return,
    Clutter.KEY_KP_Enter,
    Clutter.KEY_ISO_Enter,
];

const KEYBINDING = 'open-search-bar-key';
const GAP = 8;            // px kept free next to neighbouring panel sections
const MAX_RESULTS = 60;


export default class LauncherBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._bar = new LauncherBar();
        Main.layoutManager.addTopChrome(this._bar);

        Main.wm.addKeybinding(
            KEYBINDING,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._bar?.toggle());
    }

    disable() {
        Main.wm.removeKeybinding(KEYBINDING);
        if (this._bar) {
            this._bar.close();
            Main.layoutManager.removeChrome(this._bar);
            this._bar.destroy();
            this._bar = null;
        }
        this._settings = null;
    }
}


const LauncherBar = GObject.registerClass(
class LauncherBar extends St.BoxLayout {

    _init() {
        super._init({
            style_class: 'jal-bar',
            reactive: true,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._grab = null;
        this._busy = false;
        this._apps = [];
        this._sel = 0;
        this._appSys = Shell.AppSystem.get_default();

        this.entry = new St.Entry({
            style_class: 'jal-entry',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this.entry);

        this._results = new St.BoxLayout({
            style_class: 'jal-results',
            x_expand: true,
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._results);

        const text = this.entry.clutter_text;
        text.connect('key-press-event', this._onKeyPress.bind(this));
        text.connect('text-changed', () => {
            this._sel = 0;
            this._refresh();
        });
        text.connect('key-focus-out', () => {
            if (this._grab && !this._busy) this.close();
        });

        // clicks outside the bar while it holds the grab close it,
        // clicking a result launches it
        this.connect('captured-event', (_a, event) => {
            const type = event.type();
            if (type !== Clutter.EventType.BUTTON_PRESS &&
                type !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            const target = global.stage.get_event_actor(event);
            if (target?._jalIndex !== undefined) {
                this._sel = target._jalIndex;
                this._launch(false);
                return Clutter.EVENT_STOP;
            }
            if (!target || !this.contains(target) || target === this) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.connect('destroy', () => this.close());
    }

    // ── open / close ─────────────────────────────────────
    toggle() {
        if (this._grab) this.close();
        else this.open();
    }

    open() {
        if (this._grab || this._busy) return;
        this._busy = true;
        try {
            this._place();
            this.show();
            global.stage.set_key_focus(null);
            const grab = Main.pushModal(this, { actionMode: Shell.ActionMode.POPUP });
            try {
                this._grab = grab;
                this.entry.set_text('');
                this._sel = 0;
                this._refresh();
                this.entry.grab_key_focus();
            } catch (e) {
                // never leave the shell stuck behind a dangling modal grab
                this._grab = null;
                Main.popModal(grab);
                this.hide();
                logError(e, '[ Launcher Bar ] open failed');
            }
        } finally {
            this._busy = false;
        }
    }

    close() {
        if (!this._grab || this._busy) return;
        this._busy = true;
        const grab = this._grab;
        this._grab = null;
        try {
            this.hide();
            this.entry.set_text('');
            this._results.destroy_all_children();
            global.stage.set_key_focus(null);
        } finally {
            Main.popModal(grab);
            this._busy = false;
        }
    }

    // Fill the free panel area: end of the left section up to the centre
    // section (if it has visible content) or else the right section.
    _place() {
        const panel = Main.panel;
        const [px, py] = panel.get_transformed_position();
        const left = panel._leftBox.get_allocation_box();
        const center = panel._centerBox.get_allocation_box();
        const right = panel._rightBox.get_allocation_box();
        const centerUsed = panel._centerBox.get_children()
            .some(c => c.visible && c.width > 0);

        const x1 = left.x2 + GAP;
        const x2 = (centerUsed ? center.x1 : right.x1) - GAP;
        const width = Math.max(200, Math.floor(x2 - x1));

        this.set_position(Math.floor(px + x1), Math.floor(py));
        this.set_size(width, panel.height);
        this.entry.width = Math.max(160, Math.min(400, Math.floor(width * 0.25)));
        this._resultsWidth = width - this.entry.width - 2 * GAP;
    }

    // ── search ───────────────────────────────────────────
    _search(query) {
        const usage = Shell.AppUsage.get_default();
        const ok = app => app && app.get_app_info()?.should_show();

        if (!query.trim())
            return usage.get_most_used().filter(ok).slice(0, MAX_RESULTS);

        const seen = new Set();
        const out = [];
        for (const group of Shell.AppSystem.search(query)) {
            group.sort((a, b) => usage.compare(a, b));
            for (const id of group) {
                if (seen.has(id)) continue;
                seen.add(id);
                const app = this._appSys.lookup_app(id);
                if (ok(app)) out.push(app);
                if (out.length >= MAX_RESULTS) return out;
            }
        }
        return out;
    }

    _refresh() {
        this._apps = this._search(this.entry.get_text());
        if (this._sel >= this._apps.length) this._sel = 0;
        this._render();
    }

    // dmenu-style paging: only the page containing the selection is shown
    _render() {
        this._results.destroy_all_children();
        if (!this._apps.length) return;

        const labels = this._apps.map((app, i) => {
            const l = new St.Label({
                text: app.get_name(),
                style_class: 'jal-item',
                reactive: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            l._jalIndex = i;
            this._results.add_child(l);
            return l;
        });

        const spacing = 4;
        const avail = this._resultsWidth ?? this._results.width;
        let pageStart = 0, used = 0;
        const pageOf = [];
        labels.forEach((l, i) => {
            const w = l.get_preferred_width(-1)[1] + spacing;
            if (i > pageStart && used + w > avail) {
                pageStart = i;
                used = 0;
            }
            used += w;
            pageOf.push(pageStart);
        });

        const page = pageOf[this._sel];
        labels.forEach((l, i) => {
            l.visible = pageOf[i] === page;
            if (i === this._sel) l.add_style_pseudo_class('selected');
        });
    }

    _move(step) {
        const n = this._apps.length;
        if (!n) return;
        this._sel = ((this._sel + step) % n + n) % n;
        this._render();
    }

    _launch(newWindow) {
        const app = this._apps[this._sel];
        const query = this.entry.get_text().trim();
        this.close();

        try {
            if (app) {
                if (newWindow && app.can_open_new_window())
                    app.open_new_window(-1);
                else
                    app.activate();
                Main.overview.hide();
            } else if (query) {
                // dmenu_run fallback: run the text as a command
                GLib.spawn_command_line_async(query);
            }
        } catch (e) {
            logError(e, '[ Launcher Bar ] launch failed');
            Main.notify(`Can't launch ${app ? app.get_name() : query}`);
        }
    }

    // ── keys ─────────────────────────────────────────────
    _onKeyPress(_actor, event) {
        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const text = this.entry.clutter_text;
        const pos = text.get_cursor_position();          // -1 = end
        const atEnd = pos === -1 || pos === text.get_text().length;
        const atStart = pos === 0 || (pos === -1 && text.get_text().length === 0);

        if (sym === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (ENTER_KEYS.includes(sym)) {
            this._launch(ctrl);
            return Clutter.EVENT_STOP;
        }
        if ((sym === Clutter.KEY_Tab && !shift) || sym === Clutter.KEY_Down ||
            (ctrl && (sym === Clutter.KEY_n || sym === Clutter.KEY_j)) ||
            (sym === Clutter.KEY_Right && atEnd)) {
            this._move(1);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_ISO_Left_Tab || (sym === Clutter.KEY_Tab && shift) ||
            sym === Clutter.KEY_Up ||
            (ctrl && (sym === Clutter.KEY_p || sym === Clutter.KEY_k)) ||
            (sym === Clutter.KEY_Left && atStart)) {
            this._move(-1);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});
