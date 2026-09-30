# Installing Gitkeen

You also need Git 2.30 or newer on your computer.

## Which file to download

Choose the file for your system. Each link always gives the newest version.

| Your system | Download |
|---|---|
| macOS on Apple silicon (M1 and newer) | [Gitkeen-macOS-Apple-silicon.dmg](https://github.com/tgomilar/gitkeen/releases/latest/download/Gitkeen-macOS-Apple-silicon.dmg) |
| macOS on Intel | [Gitkeen-macOS-Intel.dmg](https://github.com/tgomilar/gitkeen/releases/latest/download/Gitkeen-macOS-Intel.dmg) |
| Windows 10 and 11 | [Gitkeen-Windows-Installer.exe](https://github.com/tgomilar/gitkeen/releases/latest/download/Gitkeen-Windows-Installer.exe) |
| Linux | [Gitkeen-Linux.AppImage](https://github.com/tgomilar/gitkeen/releases/latest/download/Gitkeen-Linux.AppImage) |
| Debian and Ubuntu | [Gitkeen-Linux.deb](https://github.com/tgomilar/gitkeen/releases/latest/download/Gitkeen-Linux.deb) |

On Fedora, openSUSE and other Linux systems, use the AppImage.

A release also lists `.app.tar.gz` files and `latest.json`. Gitkeen uses them
to update itself. You do not need to download them.

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

1. Run `Gitkeen-Windows-Installer.exe`.
2. If Windows says "Windows protected your PC", press **More info**, then
   **Run anyway**.
3. Install [Git for Windows](https://git-scm.com/download/win) if you do not
   have it yet. Gitkeen uses the `git` it finds on your `PATH`.

### Linux

For the AppImage, make the file executable, then run it:

```
chmod +x Gitkeen-Linux.AppImage
./Gitkeen-Linux.AppImage
```

For the `.deb` package on Debian or Ubuntu:

```
sudo apt install ./Gitkeen-Linux.deb
```

## Updates

Gitkeen checks for a new version a few seconds after it starts. When there is
one, a message offers **Update and restart**. The update is downloaded, its
signature is checked, and Gitkeen restarts in the new version. To check at
any time, choose **Check for updates** in the command palette.

| Installed from | Updates itself |
|---|---|
| macOS `.dmg` | Yes |
| Windows installer | Yes |
| Linux AppImage | Yes |
| Linux `.deb` | No. Download and install the new package yourself. |
