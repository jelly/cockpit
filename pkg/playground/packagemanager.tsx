import cockpit from "cockpit";
import React from 'react';
import { createRoot } from "react-dom/client";
import 'cockpit-dark-theme'; // once per page

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { Progress } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import {
    CheckIcon,
    ExclamationCircleIcon,
} from '@patternfly/react-icons';

import { getPackageManager } from '../lib/packagemanager';

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Page/page.css";
import { PackageManager, ProgressData } from "_internal/packagemanager-abstract";

const PackageManagerPage = ({ package_manager }: { package_manager: PackageManager }) => {
    const [isRefreshing, setRefreshing] = React.useState(false);
    const [isChecking, setChecking] = React.useState(false);
    const [forceRefresh, setForceRefresh] = React.useState(false);
    const [progress, setProgress] = React.useState<number | null>(null);
    const [cancelCallback, setCancelCallback] = React.useState<(() => void) | null>(null);
    const [installPackages, setInstallPackages] = React.useState("");

    const refreshProgressCallback = (data: ProgressData) => {
        console.log('progress data', data);
        setProgress(data.absolute_percentage);
        if (data.cancel)
            setCancelCallback(() => data.cancel);
    };

    const missingProgressCallback = (data: ProgressData) => {
        console.log(data);
    };

    const refreshDatabase = async () => {
        setRefreshing(true);
        await package_manager.refresh(forceRefresh, refreshProgressCallback);
        setRefreshing(false);
        setProgress(null);
    };

    const checkMissingPackages = async () => {
        setChecking(true);
        const data = await package_manager.check_missing_packages(installPackages.split(","), missingProgressCallback);
        console.log(data);
        setChecking(false);
    };

    const cancelOperation = () => {
        if (cancelCallback)
            cancelCallback();
        setRefreshing(false);
    };

    return (
        <Page id="accounts" className='no-masthead-sidebar'>
            <PageSection hasBodyWrapper={false}>
                <Content>
                    <h1>Package Manager example</h1>
                    <p>Package Manager: { package_manager.name }</p>
                    <Card>
                        <CardTitle>Refresh database</CardTitle>
                        <CardBody>
                            <Button variant="primary" onClick={() => refreshDatabase()} isLoading={isRefreshing}>Refresh</Button>
                            <Checkbox
                                  id="force-refresh"
                                  label="Force refresh"
                                  isChecked={forceRefresh}
                                  onChange={(_ev: React.FormEvent<HTMLInputElement>, val: boolean) => setForceRefresh(val)}
                            />
                            {progress && <Progress value={progress} title="Operation" max={100} />}
                            {cancelCallback !== null && <Button variant="secondary" isDanger onClick={() => cancelOperation()}>Cancel refresh</Button>}
                        </CardBody>
                    </Card>
                    <Card>
                        <CardTitle>Check missing packages test</CardTitle>
                        <CardBody>
                            <Button variant="primary" onClick={() => checkMissingPackages()} isLoading={isChecking}>Check packages</Button>
                            <TextInput value={installPackages} placeholder="packages, comma separated" onChange={(_event, value) => setInstallPackages(value)} />
                            {progress && <Progress value={progress} title="Operation" max={100} />}
                            {cancelCallback !== null && <Button variant="secondary" isDanger onClick={() => cancelOperation()}>Cancel refresh</Button>}
                        </CardBody>
                    </Card>
                </Content>
            </PageSection>
        </Page>

    );
};

document.addEventListener("DOMContentLoaded", async () => {
    const package_manager = await getPackageManager();
    console.log("package manager", package_manager);

    const root = createRoot(document.getElementById("packagemanager"));
    root.render(<PackageManagerPage package_manager={package_manager} />);
});
