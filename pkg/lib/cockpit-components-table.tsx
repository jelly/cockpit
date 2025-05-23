/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React, { useState, useEffect } from 'react';
import {
    ExpandableRowContent,
    Table, Thead, Tbody, Tr, Th, Td,
    SortByDirection,
} from '@patternfly/react-table';
import type {
    TdProps, ThProps, TrProps, TableProps,
    OnSelect,
} from '@patternfly/react-table';
import { EmptyState, EmptyStateBody, EmptyStateFooter, EmptyStateActions } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Content, ContentVariants } from "@patternfly/react-core/dist/esm/components/Content/index.js";

import './cockpit-components-table.scss';

const _ = cockpit.gettext;

/* This is a wrapper around PF Table component
 * See https://www.patternfly.org/components/table/
 * Properties (all optional unless specified otherwise):
 * - caption
 * - id: optional identifier
 * - className: additional classes added to the Table
 * - actions: additional listing-wide actions (displayed next to the list's title)
 * - columns: { title: string, header: boolean, sortable: boolean }[] or string[]
 * - rows: {
 *      columns: (React.Node or string or { title: string, key: string, ...extraProps: object}}[]
                 Through extraProps the consumers can pass arbitrary properties to the <td>
 *      props: { key: string, ...extraProps: object }
               This property is mandatory and should contain a unique `key`, all additional properties are optional.
               Through extraProps the consumers can pass arbitrary properties to the <tr>
 *      expandedContent: (React.Node)[])
 *      selected: boolean option if the row is selected
 *      initiallyExpanded : the entry will be initially rendered as expanded, but then behaves normally
 *   }[]
 * - emptyCaption: header caption to show if list is empty
 * - emptyCaptionDetail: extra details to show after emptyCaption if list is empty
 * - emptyComponent: Whole empty state component to show if the list is empty
 * - isEmptyStateInTable: if empty state is result of a filter function this should be set, otherwise false
 * - loading: Set to string when the content is still loading. This string is shown.
 * - variant: For compact tables pass 'compact'
 * - gridBreakPoint: Specifies the grid breakpoints ('', 'grid' | 'grid-md' | 'grid-lg' | 'grid-xl' | 'grid-2xl')
 * - sortBy: { index: Number, direction: SortByDirection }
 * - sortMethod: callback function used for sorting rows. Called with 3 parameters: sortMethod(rows, activeSortDirection, activeSortIndex)
 * - style: object of additional css rules
 * - afterToggle: function to be called when content is toggled
 * - onSelect: function to be called when a checkbox is clicked. Called with 5 parameters:
 *   event, isSelected, rowIndex, rowData, extraData. rowData contains props with an id property of the clicked row.
 * - onHeaderSelect: event, isSelected.
 */

interface ListingTableRowColumnProps {
    title: React.ReactNode;
    sortKey?: string;
    props?: TdProps | ThProps;
}

type ListingTableRowColumn = React.ReactNode | ListingTableRowColumnProps;

function cell_is_props(cell: ListingTableRowColumn): cell is ListingTableRowColumnProps {
    return typeof cell == "object" && (cell as ListingTableRowColumnProps).title !== undefined;
}

export interface ListingTableRowProps {
    columns: ListingTableRowColumn[];
    props?: TrProps;
    expandedContent?: React.ReactNode;
    selected?: boolean;
    initiallyExpanded?: boolean;
    hasPadding?: boolean;
}

export interface ListingTableColumnProps {
    title: string;
    header?: boolean;
    sortable?: boolean;
    props?: ThProps;
}

export interface ListingTableProps extends Omit<TableProps, 'rows' | 'onSelect'> {
    actions?: React.ReactNode[],
    afterToggle?: (expanded: boolean) => void,
    caption?: string,
    className?: string,
    columns: (string | ListingTableColumnProps)[],
    emptyCaption?: React.ReactNode,
    emptyCaptionDetail?: React.ReactNode,
    emptyComponent?: React.ReactNode,
    isEmptyStateInTable?: boolean,
    loading?: string,
    onRowClick?: (event: React.KeyboardEvent | React.MouseEvent | undefined, row: ListingTableRowProps) => void,
    onSelect?: OnSelect;
    onHeaderSelect?: OnSelect,
    rows: ListingTableRowProps[],
    showHeader?: boolean,
    sortBy?: { index: number, direction: SortByDirection },
    sortMethod?: (rows: ListingTableRowProps[], dir: SortByDirection, index: number) => ListingTableRowProps[],
}

export const ListingTable = ({
    actions = [],
    afterToggle,
    caption = '',
    className = '',
    columns: cells = [],
    emptyCaption = '',
    emptyCaptionDetail,
    emptyComponent,
    isEmptyStateInTable = false,
    loading = '',
    onRowClick,
    onSelect,
    onHeaderSelect,
    rows: tableRows = [],
    showHeader = true,
    sortBy,
    sortMethod,
    ...extraProps
} : ListingTableProps) => {
    let rows = [...tableRows];
    const [expanded, setExpanded] = useState<Record<string | number, boolean>>({});
    const [newItems, setNewItems] = useState<React.Key[]>([]);
    const [currentRowsKeys, setCurrentRowsKeys] = useState<React.Key[]>([]);
    const [activeSortIndex, setActiveSortIndex] = useState(sortBy?.index ?? 0);
    const [activeSortDirection, setActiveSortDirection] = useState(sortBy?.direction ?? SortByDirection.asc);
    const rowKeys = rows.map(row => row.props?.key)
            .filter(key => key !== undefined);
    const rowKeysStr = JSON.stringify(rowKeys);
    const currentRowsKeysStr = JSON.stringify(currentRowsKeys);

    useEffect(() => {
        // Don't highlight all when the list gets loaded
        const _currentRowsKeys: React.Key[] = JSON.parse(currentRowsKeysStr);
        const _rowKeys: React.Key[] = JSON.parse(rowKeysStr);

        if (_currentRowsKeys.length !== 0) {
            const new_keys = _rowKeys.filter(key => _currentRowsKeys.indexOf(key) === -1);
            if (new_keys.length) {
                setTimeout(() => setNewItems(items => items.filter(item => new_keys.indexOf(item) < 0)), 4000);
                setNewItems(ni => [...ni, ...new_keys]);
            }
        }

        setCurrentRowsKeys(crk => [...new Set([...crk, ..._rowKeys])]);
    }, [currentRowsKeysStr, rowKeysStr]);

    const isSortable = cells.some(col => typeof col != "string" && col.sortable);
    const isExpandable = rows.some(row => row.expandedContent);

    const tableProps: TableProps = {};

    /* Basic table properties */
    tableProps.className = "ct-table";
    if (className)
        tableProps.className = tableProps.className + " " + className;
    if (rows.length == 0)
        tableProps.className += ' ct-table-empty';

    const header = (
        (caption || actions.length != 0)
            ? <header className='ct-table-header'>
                <h3 className='ct-table-heading'> {caption} </h3>
                {actions && <div className='ct-table-actions'> {actions} </div>}
            </header>
            : null
    );

    if (loading)
        return <EmptyState>
            <EmptyStateBody>
                {loading}
            </EmptyStateBody>
        </EmptyState>;

    if (rows.length == 0) {
        let emptyState = null;
        if (emptyComponent)
            emptyState = emptyComponent;
        else
            emptyState = (
                <EmptyState>
                    <EmptyStateBody>
                        <div>{emptyCaption}</div>
                        <Content component={ContentVariants.small}>
                            {emptyCaptionDetail}
                        </Content>
                    </EmptyStateBody>
                    {actions.length > 0 &&
                    <EmptyStateFooter>
                        <EmptyStateActions>{actions}</EmptyStateActions>
                    </EmptyStateFooter>}
                </EmptyState>
            );
        if (!isEmptyStateInTable)
            return emptyState;

        const emptyStateCell = (
            [{
                props: { colSpan: cells.length },
                title: emptyState
            }]
        );

        rows = [{ columns: emptyStateCell }];
    }

    const sortRows = (): ListingTableRowProps[] => {
        function sortkey(col: ListingTableRowColumn): string {
            if (typeof col == "string")
                return col;
            if (cell_is_props(col)) {
                if (col.sortKey)
                    return col.sortKey;
                if (typeof col.title == "string")
                    return col.title;
            }
            return "";
        }

        const sortedRows = rows.sort((a, b) => {
            const aitem = a.columns[activeSortIndex];
            const bitem = b.columns[activeSortIndex];

            return sortkey(aitem).localeCompare(sortkey(bitem));
        });
        return activeSortDirection === SortByDirection.asc ? sortedRows : sortedRows.reverse();
    };

    const onSort = (_event: unknown, index: number, direction: SortByDirection) => {
        setActiveSortIndex(index);
        setActiveSortDirection(direction);
    };

    const rowsComponents = (isSortable ? (sortMethod ? sortMethod(rows, activeSortDirection, activeSortIndex) : sortRows()) : rows).map((row, rowIndex) => {
        const rowProps = row.props || {};
        if (onRowClick) {
            rowProps.isClickable = true;
            rowProps.onRowClick = (event) => onRowClick(event, row);
        }

        if (rowProps.key && newItems.indexOf(rowProps.key) >= 0)
            rowProps.className = (rowProps.className || "") + " ct-new-item";

        cockpit.assert(typeof rowProps.key != "bigint");

        const rowKey = rowProps.key || rowIndex;
        const isExpanded = expanded[rowKey] === undefined ? !!row.initiallyExpanded : expanded[rowKey];
        let columnSpanCnt = 0;
        const rowPair = (
            <React.Fragment key={rowKey + "-inner-row"}>
                <Tr {...rowProps}>
                    {isExpandable
                        ? (row.expandedContent
                            ? <Td expand={{
                                // HACK - rowIndex is declared to be a number, but we have always used
                                //        it with strings, and that worked ok. The tests expect it.
                                //        But I guess we really shouldn't...
                                rowIndex: rowKey as number,
                                isExpanded,
                                onToggle: () => {
                                    if (afterToggle)
                                        afterToggle(!expanded[rowKey]);
                                    setExpanded({ ...expanded, [rowKey]: !expanded[rowKey] });
                                }
                            }} />
                            : <Td className="pf-v6-c-table__toggle" />)
                        : null
                    }
                    {onSelect &&
                        <Td select={{
                            rowIndex,
                            onSelect,
                            isSelected: !!row.selected,
                            props: {
                                id: rowKey
                            }
                        }} />
                    }
                    {row.columns.map(cell => {
                        let props: TdProps | ThProps;
                        let children: React.ReactNode;
                        if (cell_is_props(cell)) {
                            props = cell.props || {};
                            children = cell.title;
                        } else {
                            props = {};
                            children = cell;
                        }
                        const { key, ...cellProps } = props;
                        const headerCell = cells[columnSpanCnt];
                        const dataLabel = typeof headerCell == 'object' ? headerCell.title : headerCell;
                        const colKey = dataLabel || columnSpanCnt;

                        columnSpanCnt += cellProps.colSpan || 1;

                        if (typeof headerCell != "string" && headerCell?.header) {
                            return (
                                <Th key={key || `row_${rowKey}_cell_${colKey}`} dataLabel={dataLabel}
                                    {...cellProps as ThProps}>
                                    {children}
                                </Th>
                            );
                        }

                        return (
                            <Td key={key || `row_${rowKey}_cell_${colKey}`} dataLabel={dataLabel}
                                {...cellProps as TdProps}>
                                {children}
                            </Td>
                        );
                    })}
                </Tr>
                {row.expandedContent && <Tr id={"expanded-content" + rowIndex} isExpanded={isExpanded}>
                    <Td noPadding={row.hasPadding !== true} colSpan={row.columns.length + 1 + (onSelect ? 1 : 0)}>
                        <ExpandableRowContent>{row.expandedContent}</ExpandableRowContent>
                    </Td>
                </Tr>}
            </React.Fragment>
        );

        return <Tbody key={rowKey} isExpanded={Boolean(row.expandedContent) && isExpanded}>{rowPair}</Tbody>;
    });

    return (
        <>
            {header}
            <Table {...extraProps} {...tableProps}>
                {showHeader && <Thead>
                    <Tr>
                        {/* HACK - https://github.com/patternfly/patternfly/issues/6643
                            We should probably be using screenReaderText instead of aria-label
                            for the first two here, but that will change the table layout.
                          */}
                        {isExpandable && <Th aria-label={_("Row expansion")} />}
                        {!onHeaderSelect && onSelect && <Th aria-label={_("Row select")} />}
                        {onHeaderSelect && onSelect && <Th aria-label={_("Row select")} select={{
                            onSelect: onHeaderSelect,
                            isSelected: rows.every(r => r.selected)
                        }} />}
                        {cells.map((column, columnIndex) => {
                            const columnProps = typeof column == "string" ? {} : column.props;
                            const sortParams = (
                                (typeof column != "string" && column.sortable)
                                    ? {
                                        sort: {
                                            sortBy: {
                                                index: activeSortIndex,
                                                direction: activeSortDirection
                                            },
                                            onSort,
                                            columnIndex
                                        }
                                    }
                                    : {}
                            );

                            return (
                                <Th key={columnIndex} {...columnProps} {...sortParams}>
                                    {typeof column == 'object' ? column.title : column}
                                </Th>
                            );
                        })}
                    </Tr>
                </Thead>}
                {rowsComponents}
            </Table>
        </>
    );
};
