/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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
import { File } from "cockpit/file";
import QUnit from "qunit-tests";

let dir;

QUnit.test("remove", async assert => {
    const filename = dir + "/bar";
    const exists = await cockpit.spawn(["bash", "-c", `touch ${filename} && echo exists`]);
    assert.equal(exists, "exists\n", "exists");

    const file = new File(filename);
    const tag = await file.remove();
    console.log("tag", tag);

    const res = await cockpit.spawn(["bash", "-c", `test -f ${filename} || echo -n gone`]);
    assert.equal(res, "gone", "gone");
});

QUnit.test("remove testdir", async assert => {
    await cockpit.spawn(["rm", "-rf", dir]);
    assert.ok(true, "did not crash");
});

(async () => {
    const resp = await cockpit.spawn(["bash", "-c", "d=$(mktemp -d); echo $d"]);
    dir = resp.replace(/\n$/, "");
    QUnit.start();
})();
