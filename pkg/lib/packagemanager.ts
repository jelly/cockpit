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

import cockpit from 'cockpit';

import { PackageManager } from './_internal/packagemanager-abstract';
import { Dnf5DaemonManager } from 'dnf5daemon-class';
import { PackageKitManager } from 'packagekit-class';

async function is_immutable_os() {
    try {
        const options = await cockpit.spawn(["findmnt", "-T", "/usr", "-n", "-o", "VFS-OPTIONS"]);
        return options.split(",").indexOf("ro") >= 0;
    } catch (err) {
        console.warn("Unable to detect immutable OS", err);
        return false;
    }
}

async function detect_dnf5daemon() {
    try {
        const client = cockpit.dbus("org.rpm.dnf.v0", { superuser: "try" });
        await client.call("/org/rpm/dnf/v0", "org.freedesktop.DBus.Peer", "Ping", []);
        return true;
    } catch (err) {
        console.warn("dnf5daemon not supported", err);
        return false;
    }
}

async function detect_packagekit() {
    try {
        const client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try" });
        await client.call("/org/freedesktop/PackageKit", "org.freedesktop.DBus.Properties",
                          "Get", ["org.freedesktop.PackageKit", "VersionMajor"]);
        return true;
    } catch (err) {
        console.warn("PackageKit not supported", err);
        return false;
    }
}

export async function getPackageManager(): Promise<PackageManager> {
    const unsupported = await is_immutable_os();
    if (unsupported)
        throw new Error("Unsupported package manager");

    const has_dnf5daemon = await detect_dnf5daemon();
    if (has_dnf5daemon)
        return new Dnf5DaemonManager();

    const has_packagekit = await detect_packagekit();
    if (has_packagekit)
        return new PackageKitManager();

    throw new Error("No package manager found");
}
