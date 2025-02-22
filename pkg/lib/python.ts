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

import cockpit, { BasicError } from "cockpit";

const pyinvoke = ["sh", "-ec", "exec $(command -v /usr/libexec/platform-python || command -v python3) -c \"$@\"", "--"];

export interface PythonExitStatus extends BasicError {
    exit_status: number | null,
    exit_signal: number | null,
}

// only declare the string variant for the time being; we don't use the binary variant
export function spawn (
    script_pieces: string | string[],
    args?: string[],
    options?: cockpit.SpawnOptions & { binary?: false; }
): cockpit.Spawn<string> {
    const script = (typeof script_pieces == "string")
        ? script_pieces
        : script_pieces.join("\n");

    return cockpit.spawn(pyinvoke.concat([script]).concat(args ?? []), options);
}
