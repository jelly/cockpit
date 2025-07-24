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
export type ProgressCB = (data: ProgressData) => void;

export interface ProgressData {
    // PackageManager waits on a lock or another operation to finish
    waiting: boolean
    // If not null, the operation can be cancelled
    cancel?: (() => void) | null
    // FIXME, mistake? should be percentage?
    absolute_percentage: number
}

export interface InstallProgressData extends ProgressData {
    info: string
    package: string
}

export interface MissingPackages {
    // Packages that were requested, are currently not installed, and can be installed
    missing_names: string[]
    // The full PackageKit IDs corresponding to missing_names
    missing_ids: number[]
    // Packages that were requested, are currently not installed, but can't be found in any repository
    unavailable_names: string[]
    // ???
    install_ids: number[]
    remove_ids: number[]

    // If unavailable_names is empty, a simulated installation of the missing packages
    // is done and the result also contains these fields:

    // Packages that need to be installed as dependencies of missing_names
    extra_names?: string[]
    // Packages that need to be removed
    remove_names?: string[]
    // Bytes that need to be downloaded
    download_size?: number
}

export interface PackageManager {
  // TODO: dnf5daemon / packagekit
  name: string
  // install(pkgnames: string[]): Promise<void>;
  // remove(pkgnames: string[]): Promise<void>;
  check_missing_packages(pkgnames: string[], progress_cb?: ProgressCB): Promise<MissingPackages>;
  install_missing_packages(data: MissingPackages, progress_cb?: ProgressCB): Promise<void>;
  refresh(force: boolean, progress_cb?: ProgressCB): Promise<boolean>;
}

// Custom Errors
