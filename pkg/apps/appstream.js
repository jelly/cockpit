/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import * as python from "python.js";
import inotify_py from "inotify.py";

import { debug } from "./utils";
import watch_appstream_py from "./watch-appstream.py";

let metainfo_db = null;

export function get_metainfo_db() {
    if (!metainfo_db) {
        metainfo_db = cockpit.event_target({
            ready: false,
            components: [],
            origin_files: []
        });

        let buf = "";
        python.spawn([inotify_py, watch_appstream_py], [],
                     { environ: ["LANGUAGE=" + (cockpit.language || "en")] })
                .stream(function (data) {
                    buf += data;
                    const lines = buf.split("\n");
                    buf = lines[lines.length - 1];
                    if (lines.length >= 2) {
                        const metadata = JSON.parse(lines[lines.length - 2]);
                        metainfo_db.components = metadata.components;
                        metainfo_db.origin_files = metadata.origin_files;
                        metainfo_db.ready = true;
                        metainfo_db.dispatchEvent("changed");
                        debug("read metainfo_db:", metainfo_db);
                    }
                })
                .catch(error => console.warn("watch-appstream.py failed:", error));
    }

    return metainfo_db;
}
