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
import { MissingPackages, PackageManager, ProgressCB, ProgressData } from './_internal/packagemanager-abstract';

// see https://github.com/PackageKit/PackageKit/blob/main/lib/packagekit-glib2/pk-enum.h
const Enum = {
    EXIT_SUCCESS: 1,
    EXIT_FAILED: 2,
    EXIT_CANCELLED: 3,
    ROLE_REFRESH_CACHE: 13,
    ROLE_UPDATE_PACKAGES: 22,
    INFO_UNKNOWN: -1,
    INFO_LOW: 3,
    INFO_ENHANCEMENT: 4,
    INFO_NORMAL: 5,
    INFO_BUGFIX: 6,
    INFO_IMPORTANT: 7,
    INFO_SECURITY: 8,
    INFO_DOWNLOADING: 10,
    INFO_UPDATING: 11,
    INFO_INSTALLING: 12,
    INFO_REMOVING: 13,
    INFO_REINSTALLING: 19,
    INFO_DOWNGRADING: 20,
    STATUS_WAIT: 1,
    STATUS_DOWNLOAD: 8,
    STATUS_INSTALL: 9,
    STATUS_UPDATE: 10,
    STATUS_CLEANUP: 11,
    STATUS_SIGCHECK: 14,
    STATUS_WAITING_FOR_LOCK: 30,
    FILTER_INSTALLED: (1 << 2),
    FILTER_NOT_INSTALLED: (1 << 3),
    FILTER_NEWEST: (1 << 16),
    FILTER_ARCH: (1 << 18),
    FILTER_NOT_SOURCE: (1 << 21),
    ERROR_ALREADY_INSTALLED: 9,
    TRANSACTION_FLAG_SIMULATE: (1 << 2),
};

const transactionInterface = "org.freedesktop.PackageKit.Transaction";

type DBusArgument = number | boolean | string | { [key: string]: DBusArgument } | DBusArgument[];

interface SignalHandler {
    ErrorCode: (code: number, details: string) => void | undefined
    Finished: (exit: number) => void | undefined
}

class TransactionError extends Error {
    code: number;
    detail: string;

    constructor(code: number, detail: string) {
        super(detail);
        this.detail = detail;
        this.code = code;
    }
}

let _dbus_client: cockpit.DBusClient | null = null;

/**
 * Get PackageKit D-Bus client
 *
 * This will get lazily initialized and re-initialized after PackageKit
 * disconnects (due to a crash or idle timeout).
 */
function dbus_client() {
    if (_dbus_client === null) {
        _dbus_client = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try", track: true });
        _dbus_client.addEventListener("close", () => {
            console.log("PackageKit went away from D-Bus");
            _dbus_client = null;
        });
    }

    return _dbus_client;
}

/**
 * Call a PackageKit method
 */
function call(objectPath: string, iface: string, method: string, args?: unknown[], opts?: cockpit.DBusCallOptions) {
    return dbus_client().call(objectPath, iface, method, args, opts);
}

// Reconnect when privileges change
superuser.addEventListener("changed", () => { _dbus_client = null });

/**
 * Watch a running PackageKit transaction
 *
 * transactionPath (string): D-Bus object path of the PackageKit transaction
 * signalHandlers, notifyHandler: As in method #transaction
 * Returns: If notifyHandler is set, Cockpit promise that resolves when the watch got set up
 */
export function watchTransaction(transactionPath: string, signalHandlers?: SignalHandler, notifyHandler?: () => void) {
    const subscriptions = [];
    let notifyReturn;
    const client = dbus_client();

    // Listen for PackageKit crashes while the transaction runs
    function onClose(event, ex) {
        console.warn("PackageKit went away during transaction", transactionPath, ":", JSON.stringify(ex));
        if (signalHandlers.ErrorCode)
            signalHandlers.ErrorCode("close", _("PackageKit crashed"));
        if (signalHandlers.Finished)
            signalHandlers.Finished(Enum.EXIT_FAILED);
    }
    client.addEventListener("close", onClose);

    if (signalHandlers) {
        Object.keys(signalHandlers).forEach(handler => subscriptions.push(
            client.subscribe({ interface: transactionInterface, path: transactionPath, member: handler },
                             (path, iface, signal, args) => signalHandlers[handler](...args)))
        );
    }

    if (notifyHandler) {
        notifyReturn = client.watch(transactionPath);
        subscriptions.push(notifyReturn);
        client.addEventListener("notify", reply => {
            const iface = reply?.detail?.[transactionPath]?.[transactionInterface];
            if (iface)
                notifyHandler(iface, transactionPath);
        });
    }

    // unsubscribe when transaction finished
    subscriptions.push(client.subscribe(
        { interface: transactionInterface, path: transactionPath, member: "Finished" },
        () => {
            subscriptions.map(s => s.remove());
            client.removeEventListener("close", onClose);
        })
    );

    return notifyReturn;
}

/**
 * Run a PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
 *                  If undefined, only a transaction will be created without calling a method on it
 * arglist (array): "in" arguments of @method
 * signalHandlers (object): maps PackageKit.Transaction signal names to handlers
 * notifyHandler (function): handler for https://cockpit-project.org/guide/latest/cockpit-dbus.html#cockpit-dbus-onnotify
 *                           signals, called on property changes with (changed_properties, transaction_path)
 * Returns: Promise that resolves with transaction path on success, or rejects on an error
 *
 * Note that most often you don't really need the transaction path, but want to
 * listen to the "Finished" signal.
 *
 * Example:
 *     transaction("GetUpdates", [0], {
 *             Package: (info, packageId, _summary) => { ... },
 *             ErrorCode: (code, details) => { ... },
 *         },
 *         changedProps => { ... }  // notify handler
 *     )
 *        .then(transactionPath => { ... })
 *        .catch(ex => { handle exception });
 */
export function transaction(method?: string, arglist?: unknown[], signalHandlers?: SignalHandler, notifyHandler?: () => void) {
    return call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [])
            .then(([transactionPath]) => {
                cockpit.assert(typeof transactionPath === 'string');
                if (!signalHandlers && !notifyHandler)
                    return transactionPath;

                const watchPromise = watchTransaction(transactionPath, signalHandlers, notifyHandler) || Promise.resolve();
                return watchPromise.then(() => {
                    if (method) {
                        return call(transactionPath, transactionInterface, method, arglist)
                                .then(() => transactionPath);
                    } else {
                        return transactionPath;
                    }
                });
            });
}

/**
 * Run a long cancellable PackageKit transaction
 *
 * method (string): D-Bus method name on the https://www.freedesktop.org/software/PackageKit/gtk-doc/Transaction.html interface
 * arglist (array): "in" arguments of @method
 * progress_cb: Callback that receives a {waiting, percentage, cancel} object regularly; if cancel is not null, it can
 *              be called to cancel the current transaction. if wait is true, PackageKit is waiting for its lock (i. e.
 *              on another package operation)
 * signalHandlers, notifyHandler: As in method #transaction, but ErrorCode and Finished are handled internally
 * Returns: Promise that resolves when the transaction finished successfully, or rejects with TransactionError
 *          on failure.
 */
function cancellableTransaction(method: string, arglist?: unknown[], progress_cb?: ((data: ProgressData) => void) | null, signalHandlers?: SignalHandler) {
    if (signalHandlers?.ErrorCode || signalHandlers?.Finished)
        throw Error("cancellableTransaction handles ErrorCode and Finished signals internally");

    return new Promise((resolve, reject) => {
        let cancelled = false;
        let status;
        let allow_wait_status = false;
        const progress_data: ProgressData = {
            waiting: false,
            absolute_percentage: 0,
            cancel: null
        };

        function changed(props, transaction_path?: string) {
            function cancel() {
                call(transaction_path, transactionInterface, "Cancel", []);
                cancelled = true;
            }

            if (progress_cb) {
                if ("Status" in props)
                    status = props.Status;
                progress_data.waiting = allow_wait_status && (status === Enum.STATUS_WAIT || status === Enum.STATUS_WAITING_FOR_LOCK);
                if ("AllowCancel" in props)
                    progress_data.cancel = props.AllowCancel ? cancel : null;
                if ("Percentage" in props && props.Percentage <= 100)
                    progress_data.absolute_percentage = props.Percentage;

                progress_cb(progress_data);
            }
        }

        // We ignore STATUS_WAIT and friends during the first second of a transaction.  They
        // are always reported briefly even when a transaction doesn't really need to wait.
        window.setTimeout(() => {
            allow_wait_status = true;
            changed({});
        }, 1000);

        transaction(method, arglist,
                    Object.assign({
                        // avoid calling progress_cb after ending the transaction, to avoid flickering cancel buttons
                        ErrorCode: (code, detail) => {
                            progress_cb = null;
                            reject(new TransactionError(cancelled ? "cancelled" : code, detail));
                        },
                        Finished: exit => {
                            progress_cb = null;
                            resolve(exit);
                        },
                    }, signalHandlers || {}),
                    changed)
                .catch(ex => {
                    progress_cb = null;
                    reject(ex);
                });
    });
}

export class PackageKitManager implements PackageManager {
    name: string;

    constructor() {
        this.name = "packagekit";
    }

    async refresh(force: boolean = false, progress_cb?: (data: ProgressData) => void) {
        try {
            await cancellableTransaction("RefreshCache", [force], progress_cb);
            return true;
        } catch (err) {
            console.warn("RefreshCache failed", err);
            return false;
        }
    }

    async check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages> {
        let data: MissingPackages = {
            missing_ids: [],
            missing_names: [],
            unavailable_names: [],
        };

        function resolve() {
            const installed_names = { };

            return cancellableTransaction("Resolve",
                                          [Enum.FILTER_ARCH | Enum.FILTER_NOT_SOURCE | Enum.FILTER_NEWEST, pkgnames],
                                          progress_cb,
                                          {
                                              Package: (info, package_id) => {
                                                  const parts = package_id.split(";");
                                                  const repos = parts[3].split(":");
                                                  if (repos.indexOf("installed") >= 0) {
                                                      installed_names[parts[0]] = true;
                                                  } else {
                                                      data.missing_ids.push(package_id);
                                                      data.missing_names.push(parts[0]);
                                                  }
                                              },
                                          })
                    .then(() => {
                        pkgnames.forEach(name => {
                            if (!installed_names[name] && data.missing_names.indexOf(name) == -1)
                                data.unavailable_names.push(name);
                        });
                        return data;
                    });
        }

        function simulate(data) {
            data.install_ids = [];
            data.remove_ids = [];
            data.extra_names = [];
            data.remove_names = [];

            if (data.missing_ids.length > 0 && data.unavailable_names.length === 0) {
                return cancellableTransaction("InstallPackages",
                                              [Enum.TRANSACTION_FLAG_SIMULATE, data.missing_ids],
                                              progress_cb,
                                              {
                                                  Package: (info, package_id) => {
                                                      const name = package_id.split(";")[0];
                                                      if (info == Enum.INFO_REMOVING) {
                                                          data.remove_ids.push(package_id);
                                                          data.remove_names.push(name);
                                                      } else if (info == Enum.INFO_INSTALLING ||
                                                             info == Enum.INFO_UPDATING) {
                                                          data.install_ids.push(package_id);
                                                          if (data.missing_names.indexOf(name) == -1)
                                                              data.extra_names.push(name);
                                                      }
                                                  }
                                              })
                        .then(() => {
                            data.missing_names.sort();
                            data.extra_names.sort();
                            data.remove_names.sort();
                            return data;
                        });
            } else {
                return data;
            }
        }

        function get_details(data) {
            data.download_size = 0;
            if (data.install_ids.length > 0) {
                return cancellableTransaction("GetDetails",
                                              [data.install_ids],
                                              progress_cb,
                                              {
                                                  Details: details => {
                                                      if (details.size)
                                                          data.download_size += details.size.v;
                                                  }
                                              })
                        .then(() => data);
            } else {
                return data;
            }
        }

        if (pkgnames.length === 0)
            return data;

        try {
            await this.refresh(false, progress_cb);
            data = await resolve();
            data = await simulate(data);
            data = await get_details(data);
        } catch (err) {
            console.warn("check_missing_packages exception", err);
            throw err;
        }

        return data;
    }

    async install_missing_packages(data: MissingPackages, progress_cb?: ProgressCB): Promise<void> {
        if (!data || data.missing_ids.length === 0)
            return;

        let last_progress;
        let last_info;
        let last_name;

        function report_progess() {
            progress_cb({
                waiting: last_progress.waiting,
                percentage: last_progress.percentage,
                cancel: last_progress.cancel,
                info: last_info,
                package: last_name
            });
        }

        return cancellableTransaction("InstallPackages", [0, data.missing_ids],
                                      p => {
                                          last_progress = p;
                                          report_progess();
                                      },
                                      {
                                          Package: (info, id) => {
                                              last_info = info;
                                              last_name = id.split(";")[0];
                                              report_progess();
                                          }
                                      });
    }
}
