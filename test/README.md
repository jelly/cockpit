# Integration Tests of Cockpit

This directory contains automated integration tests for Cockpit, and the support
files for them.

To run the tests on Fedora, refer to the [HACKING](../HACKING.md) guide for
installation of all of the necessary build and test dependencies. There's
no need to trigger a build manually - the test suite preparation step below
will handle that.

If test failures are encountered that look like they may be related to problems
with nested virtualization, refer to
[this Fedora guide](https://docs.fedoraproject.org/en-US/quick-docs/using-nested-virtualization-in-kvm/index.html)
for more details and recommendations on ensuring it is enabled correctly.

## Preparation and general invocation

*Warning*: Never run the build, test, or any other command here as root!

You first need to build cockpit, and install it into a VM:

    test/image-prepare

This uses the default OS image, which is currently Fedora 38. See `$TEST_OS`
below how to select a different one.

In most cases you want to run an individual test in a suite, for example:

    test/verify/check-metrics TestCurrentMetrics.testCPU

You can get a list of tests by inspecting the `def test*` in the source, or by
running the suite with `-l`/`--list`:

    test/verify/check-metrics -l

Sometimes you may also want to run all tests in a test file suite:

    test/verify/check-session

To see more verbose output from the test, use the `-v`/`--verbose` and/or `-t`/`--trace` flags:

    test/verify/check-session --verbose --trace

If you specify `-s`/`--sit` in addition, then the test will wait on failure and
allow you to log into cockpit and/or the test instance and diagnose the issue.
The cockpit and SSH addresses of the test instance will be printed:

    test/verify/check-session -st

You can also run *all* the tests, with some parallelism:

    test/common/run-tests --test-dir test/verify --jobs 2

However, this will take *really* long. You can specify a subset of tests (see
`--help`); but usually it's better to run individual tests locally, and let the
CI machinery run all of them in a draft pull request.

The tests will automatically download the VM images they need, so expect
that the initial run may take a few minutes.

## Interactive browser

Normally each test starts its own chromium headless browser process on a
separate random port. To interactively follow what a test is doing:

    TEST_SHOW_BROWSER=1 test/verify/check-session --trace

You can also run a test against Firefox instead of Chromium:

    TEST_BROWSER=firefox test/verify/check-session --trace

See below for details.

## Manual testing

You can conduct manual interactive testing against a test image by starting the
image like so:

     bots/vm-run -s cockpit.socket debian-stable

Once the machine is booted and the cockpit socket has been activated, a
message will be printed describing how to access the virtual machine, via
ssh and web.  See the "Helpful tips" section below.

## Pixel tests

The verify test suite contains ["pixel tests"](https://cockpit-project.org/blog/pixel-testing.html).
Make sure to create the test/reference submodule before running tests which contain pixel tests.

 * test/common/pixel-tests pull

## Test Configuration

You can set these environment variables to configure the test suite:

* `TEST_OS`: The OS to run the tests in.  Currently supported values:
                  "centos-8-stream"
                  "debian-stable"
                  "debian-testing"
                  "fedora-37"
                  "fedora-38"
                  "fedora-coreos"
                  "fedora-testing"
                  "rhel-8-9"
                  "rhel-8-9-distropkg"
                  "rhel-9-3"
                  "rhel4edge",
                  "ubuntu-2204"
                  "ubuntu-stable"
                  "fedora-38" is the default (TEST_OS_DEFAULT in bots/lib/constants.py)

* `TEST_JOBS`: How many tests to run in parallel.  The default is 1.

* `TEST_CDP_PORT`: Attach to an actually running browser that is compatible with
                   the Chrome Debug Protocol, on the given port. Don't use this
                   with parallel tests.

* `TEST_BROWSER`: What browser should be used for testing. Currently supported values:
                     "chromium"
                     "firefox"
                  "chromium" is the default.

* `TEST_SHOW_BROWSER`: Set to run browser interactively. When not specified,
                       browser is run in headless mode. When set to "pixels",
                       the browser will be resized to the exact dimensions that
                       are used for pixel tests.

* `TEST_TIMEOUT_FACTOR`: Scale normal timeouts by given integer. Useful for
                        slow/busy testbeds or architectures.

See the [bots documentation](https://github.com/cockpit-project/bots/blob/main/README.md)
for details about the tools and configuration for these.

## Convenient test VM SSH access

It is recommended to add a snippet like this to your `~/.ssh/config`. Then
you can log in to test machines without authentication:

    Match final host 127.0.0.2
        User root
        StrictHostKeyChecking no
        UserKnownHostsFile /dev/null
        CheckHostIp no
        IdentityFile CHECKOUT_DIR/bots/machine/identity
        IdentitiesOnly yes

You need to replace `CHECKOUT_DIR` with the actual directory where you cloned
`cockpit.git`, or `bots.git` if you have a separate clone for that.

Many cockpit developers take it a step further, and add an alias to
allow typing `ssh c`:

    Host c
        Hostname 127.0.0.2
        Port 2201

The `final` keyword in the first rule will cause it to be checked (and matched)
after the `Hostname` substitution in the `c` rule.

## Fast develop/test iteration

Each `image-prepare` invocation will always start from the pristine image and
ignore the current overlay in `test/images`. It is thorough, but also rather
slow. If you want to iterate on changing only JavaScript/HTML code, as opposed
to the bridge or webserver, the whole build and test cycle can be done much
faster.

You always need to do at least one initial `test/image-prepare $TEST_OS` run.
Afterwards it depends on the kind of test you want to run.

### Nondestructive tests

Many test methods or classes are marked as `@nondestructive`, meaning that
they restore the state of the test VM enough that other tests can run
afterwards. This is the fastest and most convenient situation for both
iterating on the code and debugging failing tests.

Start the prepared VM with `bots/vm-run $TEST_OS`. Note the SSH and cockpit
ports. If this is the only running VM, it will have the ports in the
examples below, otherwise the port will be different.

Then start building the page you are working on
[in watch and rsync mode](../HACKING.md#working-on-cockpits-session-pages), e.g.

    RSYNC=c ./build.js -w users

(Assuming the `c` SSH alias from the previous section and first running VM).

Then you can run a corresponding test against the running VM, with additional
debug output:

    TEST_OS=... test/verify/check-users -t --machine 127.0.0.2:2201 --browser 127.0.0.2:9091 TestAccounts.testBasic

### Destructive tests

Other tests need one or more fresh VMs. Instead of a full `test/image-prepare`
run (which is slow), you can update the existing VM overlay with updated
bundles. Start the build in watch mode, but without rsyncing, e.g.

    ./build.js -w storaged

and after each iteration, copy the new bundles into the VM overlay:

    bots/image-customize -u dist:/usr/share/cockpit/ $TEST_OS

Then run the test as you would normally do, e.g.

    TEST_OS=... test/verify/check-storage-stratis -t TestStorageStratis.testBasic

Use `bots/vm-reset` to clean up all prepared overlays in `test/images`.

## Debugging tests

If you pass the `-s` ("sit on failure") option to a test program, it
will pause when a failure occurs so that you can log into the test
machine and investigate the problem.

A test will print out the commands to access it when it fails in this
way. You can log into a running test-machine using ssh.  See the
"Helpful tips" section below.

You can also put calls to `sit()` into the tests themselves to stop them
at strategic places.

That way, you can run a test cleanly while still being able to make
quick changes, such as adding debugging output to JavaScript.

## Guidelines for writing tests

The integration tests are located in the `verify` directory and usually named
`test-$page-$component` for example `check-system-terminal`. All tests are written
using Python's `unittest` library and inherit from `MachineCase`. Below
is an example of a test which logs in and verifies that expected HTML classes
are there:

```python
class TestLogin(MachineCase):
    def testBasic(self):
        b = self.browser
        m = self.machine

        b.open("/system")
        b.wait_visible("#login")
        b.set_val("#login-user-input", "admin")
        b.set_val("#login-password-input", "foobar")
        b.click("#login-button")
        b.enter_page("/system")

        b.wait_visible("#content")
        b.wait_visible('#system_information_os_text')
```

We define a new test class `TestLogin` which inherits from the `MachineCase`
class, this class does a few things for us. It gives us a `self.machine`
variable which is a `TestVM` object that can be used to interact with the test
machine. The `self.browser` variable is an instance of the `Browser` class
which is how we interact with the test browser and control it.

### Conditional execution of tests

Cockpit is tested on multiple distributions and versions, some features are
specific to one particular distro for such scenario's Cockpit has multiple ways
to skip a test.

To only test on RHEL the `onlyImage` decorator can be used
```
@onlyImage('rhel-*')
class TestRhelFeature(MachineCase):
    ...
```

To skip a test because for example RHEL lacks a feature:

```python
@skipImage("no btrfs support on RHEL", "rhel-*")`
class TestBtrfs(MachineCase):
    ...
```

Other commonly used decorators:

* `skipOstree` - skip a test on an OSTree based distribution
* `skipMobile` - skip a test on a mobile resolution

All test decorators can be found in [test/common/testlib.py](https://github.com/cockpit-project/cockpit/blob/293/test/common/testlib.py#L2171)

### Destructive versus non-destructive tests

Cockpit tests can be divided into two types of tests, decorated with
`@nondestructive` and without. When running the test suite, the tests are
divided into separate groups of destructive and non-destructive tests. A
non-Destructive tests can be run multiple times with the same test machine and
run after each other and do not interfere with other tests. Destructive tests
make it so that another test can not run after it completed.

For non-destructive tests we have several helpers which can restore edited
files or directories to their previous state, such as:

* `self.write_file` - write or appends content to a file and automatically
  restores the old contents, also can optionally accept a `post_restore_action`
  to for example restart a service.
* `self.restore_file` / `self.restore_dir` - call this before executing
  destructive file operations, to automatically have the old contents restored
  after the test finished, also can optionally accept a `post_restore_action`
  to for example restart a service.
* `self.addCleanup` - this [unittest module
  function](https://docs.python.org/3/library/unittest.html?highlight=addcleanup#unittest.TestCase.addCleanup)
  can be used clean up temporarily files / or stop started services. For
  example `self.addCleanup(m.execute, "systemctl stop redis")`.

### Writing tests for bugs

Start with an integration test which reproduces the issue, then develop
against that to make the test pass.

See for example [this commit](https://github.com/cockpit-project/cockpit/commit/d23a4647aed91d2ae3ba117919aab8172117a383)

### Writing tests for features

For a new feature, our goal is usually to cover both the "positive"
functionalities, as well as a reasonable set of corner cases and error
conditions (guided by coverage reports).

See for example [this commit](https://github.com/cockpit-project/cockpit/commit/109dc1c7ea348d9f77e37f38d860f84b750f6f7e)

As generating coverage takes quite a while, feel free to open a PR first which
will trigger a `$TEST_OS/devel` test run which contains a link to coverage.
Coverage generation is only available for Cockpit and Cockpit-podman.

## Helpful tips

For web access, if you'd like to avoid Chromium (or Chrome) prompting
about certificate errors while connecting to localhost, you can change
the following setting:

    chrome://flags/#allow-insecure-localhost

### Unexpected journal message

After a test run the testsuite reads the journal, looks for errors and fails
the test if there are errors. As a test can cause harmless errors to end up in
the journal our test library defines a list of allowed journal messages. If
your test triggers a harmless error message you can add it to the allow list
using `self.allow_journal_messages`.

During local testing SELinux violations can be ignored by setting
`TEST_AUDIT_NO_SELINUX`.

### Generating test coverage

For coverage we need to build a development build:

    export NODE_ENV=devel
    ./build.js
    ./test/image-prepare -q
    ./test/common/run-tests --test-dir test/verify --coverage TestFoo.testBasic

