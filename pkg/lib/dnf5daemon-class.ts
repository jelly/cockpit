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
import { superuser } from 'superuser';
import { Enum } from "packagekit";
import { MissingPackages, PackageManager, ProgressCB, ProgressData } from './_internal/packagemanager-abstract';

let _dbus_client: cockpit.DBusClient | null = null;

/**
 * Get dnf5daemon D-Bus client
 *
 * This will get lazily initialized and re-initialized after dnf5daemon
 * disconnects (due to a crash or idle timeout).
 */
function dbus_client() {
    if (_dbus_client === null) {
        _dbus_client = cockpit.dbus("org.rpm.dnf.v0", { superuser: "try", track: true });
        _dbus_client.addEventListener("close", () => {
            console.log("dnf5daemon went away from D-Bus");
            _dbus_client = null;
        });
    }

    return _dbus_client;
}

function open_session(): Promise<string[]> {
    return call("/org/rpm/dnf/v0", "org.rpm.dnf.v0.SessionManager",
                "open_session", [{}]) as Promise<string[]>;
}

function close_session(session) {
    console.log('close session', session);
    return call("/org/rpm/dnf/v0", "org.rpm.dnf.v0.SessionManager",
                "close_session", [session]);
}

// Reconnect when privileges change
superuser.addEventListener("changed", () => { _dbus_client = null });

/**
 * Call a dnf5daemon method
 */
export function call(objectPath: string, iface: string, method: string, args?: never[], opts?: cockpit.DBusCallOptions) {
    return dbus_client().call(objectPath, iface, method, args, opts);
}

export class Dnf5DaemonManager implements PackageManager {
    name: string;

    constructor() {
        // TODO: create client and session here?
        console.log('constructed dnf5daemon');
        this.name = 'dnf5daemon';
    }

    private async read_all_repos(session: string) {
        try {
            await call(session, "org.rpm.dnf.v0.Base", "read_all_repos", []);
            const resolve_results = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);
            console.log("resolve results", resolve_results);
            const transaction_results = await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
            console.log(transaction_results);
            return true;
        } catch (err) {
            console.warn("could not read repos", err);
            return false;
        }
    }

    async refresh(force: boolean = false, progress_cb?: (data: ProgressData) => void) {
        let session;
        let success = false;
        let error_msg = "";

        function signal_emitted(path, iface, signal, args) {
            console.log("signal_emitted", path, iface, signal, args);
            if (progress_cb)
                progress_cb(signal);
        }

        const client = dbus_client();
        const subscription = client.subscribe({}, signal_emitted);

        try {
            [session] = await open_session();
            await this.read_all_repos(session);
            [success, error_msg] = await call(session, "org.rpm.dnf.v0.Base", "clean", [force ? "all" : "expire-cache"]) as [boolean, string];
            await close_session(session);
        } catch (err) {
            console.warn(err);
            if (session)
                await close_session(session);
            throw err;
        }

        subscription.remove();
        // HACK: close the client so subscribe matches are actually dropped. https://github.com/cockpit-project/cockpit/issues/21905
        client.close();

        if (!success)
            console.warn("failed to clean cache", error_msg);
        return success;
    }

    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        const data: MissingPackages = {
            extra_names: [],
            missing_ids: [],
            missing_names: [],
            unavailable_names: [],
            install_ids: [],
            remove_ids: [],
            remove_names: [],
        };

        if (pkgnames.length === 0)
            return data;

        async function refresh(session) {
        // refresh dnf5daemon state
            await call(session, "org.rpm.dnf.v0.Base", "read_all_repos", []);
            const resolve_results = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);
            console.log("resolve results", resolve_results);
            const transaction_results = await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
            console.log(transaction_results);
        }

        async function resolve(session) {
            const installed_names = { };
            const seen_names = new Set();
            const package_attrs = ["name", "version", "release", "arch", "download_size", "is_installed"];
            console.log("names", pkgnames);

            const [results] = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "list", [
                {
                    package_attrs: { t: 'as', v: package_attrs },
                    scope: { t: 's', v: "all" },
                    patterns: { t: 'as', v: pkgnames }
                }
            ]);
            console.log("list result", results, results.length);
            for (const pkg of results) {
                console.log(pkg);
                if (seen_names.has(pkg.name.v))
                    continue;

                if (pkg.is_installed.v) {
                    installed_names[pkg.name.v] = true;
                } else {
                    data.missing_ids.push(pkg.id.v);
                    data.missing_names.push(pkg.name.v);
                }

                seen_names.add(pkg.name.v);
            }
            console.log(data);

            pkgnames.forEach((name: string) => {
                if (!installed_names[name] && data.missing_names.indexOf(name) == -1)
                    data.unavailable_names.push(name);
            });
        }

        async function simulate(session) {
            if (data.missing_ids.length === 0 || data.unavailable_names.length > 0) {
                return null;
            }

            //  method install(as specs, a{sv} options) → ()
            const results = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "install", [pkgnames, {}]);
            console.log(results);
            const [resolve_results] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);
            console.log("resolve results", resolve_results);
            data.download_size = 0;
            for (const result of resolve_results) {
                const [sort, action, reason, _leftover, pkg] = result;
                const name = pkg.name.v;
                console.log(action, reason, pkg);

                if (sort !== "Package")
                    continue;

                if (reason == "Dependency") {
                    data.install_ids.push(pkg.id.v);
                    if (data.missing_names.indexOf(name) == -1)
                        data.extra_names.push(name);

                    data.download_size = pkg.download_size.v;
                }

                // TODO: support removals

                console.log(pkg);
            }
        }

        function signal_emitted(path, iface, signal, args) {
            console.log("signal_emitted", path, iface, signal, args);
            if (progress_cb)
                progress_cb(signal);
        }

        // TODO: decorator / helper for opening a session?
        let session;
        const client = dbus_client();
        const subscription = client.subscribe({}, signal_emitted);

        try {
            [session] = await open_session();
            console.log(session);
            await refresh(session);
            await resolve(session);
            await simulate(session);
            await close_session(session);
        } catch (err) {
            console.warn(err);
            if (session)
                await close_session(session);
            throw err;
        }

        subscription.remove();
        // HACK: close the client so subscribe matches are actually dropped. https://github.com/cockpit-project/cockpit/issues/21905
        client.close();

        return data;
    }

    async install_missing_packages(data: MissingPackages, progress_cb?: ProgressCB): Promise<void> {
        if (!data || data.missing_ids.length === 0)
            return;

        let last_info;
        let last_progress;
        let last_name;
        let total_packages;
        let last_verifying;

        function signal_emitted(path, iface, signal, args) {
            let package_name;
            console.log("signal_emitted", path, iface, signal, args);
            switch (signal) {
            // download_add_new(o session_object_path, s download_id, s description, x total_to_download)
            case 'download_add_new':
                last_info = Enum.INFO_DOWNLOADING;
                last_name = args[2];
                break;
                // download_progress(o session_object_path, s download_id, x total_to_download, x downloaded)
            case 'download_progress':
                last_info = Enum.INFO_DOWNLOADING;
                const [, download_id, total_to_download, downloaded] = args;
                break;
                // download_end(o session_object_path, s download_id, u transfer_status, s message)
            case 'download_end':
            // const [object_path, download_id, transfer_status, message] = args;
                last_info = null;
                last_name = null;
                break;
                //     last_info = Enum.INFO_REMOVING;
            case 'transaction_before_begin':
                [, total_packages] = args;
                last_info = Enum.INFO_INSTALLING;
                last_verifying = true;
                break;
                // transaction_elem_progress(o session_object_path, s nevra, t processed, t total)
            case 'transaction_elem_progress':
                let processed;
                last_verifying = false;
                [, last_name, processed,] = args;
                last_progress = processed / total_packages * 100;
                break;
            }

            // if (signal === 'download_add_new') {
            //     last_info = Enum.INFO_DOWNLOADING;
            //     package_name = args[2];
            // } else {
            //     last_info = Enum.INFO_INSTALLING;
            // }

            // if (signal.startsWith('transaction_elem')) {
            //     package_name = args[1];
            // }

            if (progress_cb)
                progress_cb({
                    cancel: null,
                    info: last_info,
                    package: last_name,
                    percentage: last_progress,
                    verifying: last_verifying,
                });
        }

        const client = dbus_client();
        const subscription = client.subscribe({}, signal_emitted);
        let session;

        try {
            [session] = await open_session();
            const results = await call(session, "org.rpm.dnf.v0.rpm.Rpm", "install", [data.missing_names, {}]);
            console.log("install results", results);
            const [resolve_results] = await call(session, "org.rpm.dnf.v0.Goal", "resolve", [{}]);
            console.log("resolve results", resolve_results);
            const transaction_results = await call(session, "org.rpm.dnf.v0.Goal", "do_transaction", [{}]);
            console.log("transaction results", transaction_results);
            await close_session(session);
        } catch (err) {
            console.warn("install error", err);
            if (session)
                await close_session(session);
        }

        subscription.remove();
        client.close();
    }
}
