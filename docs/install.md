# Installing Gitkeen

Download Gitkeen from the [latest release](https://github.com/tgomilar/gitkeen/releases/latest).
You also need Git 2.30 or newer on your computer.

## Which file to download

| System | File |
|---|---|
| macOS on Apple silicon (M1 and newer) | `Gitkeen_<version>_aarch64.dmg` |
| macOS on Intel | `Gitkeen_<version>_x64.dmg` |
| Windows 10 and 11 | `Gitkeen_<version>_x64-setup.exe` (or the `.msi`) |
| Linux, any distribution | `Gitkeen_<version>_amd64.AppImage` |
| Debian and Ubuntu | `Gitkeen_<version>_amd64.deb` |
| Fedora and openSUSE | `Gitkeen-<version>-1.x86_64.rpm` |

To see which kind of Mac you have, open the Apple menu and choose **About This
Mac**. A chip named "Apple M" is Apple silicon.

## Opening Gitkeen the first time

Gitkeen is not signed with a paid developer certificate yet. Your system
therefore cannot check who made it, and asks you once before it opens it.

### macOS

1. Open the `.dmg` and drag **Gitkeen** to **Applications**.
2. Open Gitkeen. macOS says that it cannot check the app. Press **Done**.
3. Open **System Settings**, then **Privacy & Security**.
4. Scroll down to the message about Gitkeen and press **Open Anyway**.
5. Confirm with your password. From now on, Gitkeen opens normally.

If macOS says that the app "is damaged", run this once in Terminal, then open
Gitkeen again:

```
xattr -dr com.apple.quarantine /Applications/Gitkeen.app
```

### Windows

1. Run the `-setup.exe` file.
2. If Windows says "Windows protected your PC", press **More info**, then
   **Run anyway**.
3. Install [Git for Windows](https://git-scm.com/download/win) if you do not
   have it yet. Gitkeen uses the `git` it finds on your `PATH`.

### Linux

For the AppImage, make the file executable, then run it:

```
chmod +x Gitkeen_*_amd64.AppImage
./Gitkeen_*_amd64.AppImage
```

For the `.deb` package on Debian or Ubuntu:

```
sudo apt install ./Gitkeen_*_amd64.deb
```

For the `.rpm` package on Fedora:

```
sudo dnf install ./Gitkeen-*.x86_64.rpm
```

## Updates

Gitkeen checks for a new version a few seconds after it starts. When there is
one, a message offers **Update and restart**. The update is downloaded, its
signature is checked, and Gitkeen restarts in the new version. To check at
any time, choose **Check for updates** in the command palette.

| Installed from | Updates itself |
|---|---|
| macOS `.dmg` | Yes |
| Windows `-setup.exe` or `.msi` | Yes |
| Linux AppImage | Yes |
| Linux `.deb` or `.rpm` | No. Download and install the new package yourself. |
